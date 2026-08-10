using System.Diagnostics.CodeAnalysis;
using Cadence.Data.Stems;

namespace Cadence.SeparationWorker;

/// <summary>
/// The hosted poll loop that drives the async separation pipeline: it repeatedly
/// asks the <see cref="SeparationJobProcessor"/> to claim and process the next
/// queued job, sleeping briefly whenever the queue is empty, and periodically
/// reclaims jobs abandoned by a crashed worker. The processor holds a scoped
/// <c>DbContext</c>, so a fresh DI scope is opened per iteration.
/// </summary>
/// <remarks>
/// This is thin hosting glue around the fully unit-tested
/// <see cref="SeparationJobProcessor"/>, so it is excluded from unit-coverage and
/// exercised end-to-end by the Aspire integration tests.
/// </remarks>
[ExcludeFromCodeCoverage]
public sealed class SeparationBackgroundService(
    IServiceProvider services,
    ILogger<SeparationBackgroundService> logger) : BackgroundService
{
    private static readonly TimeSpan IdleDelay = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan ErrorBackoff = TimeSpan.FromSeconds(5);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Stem separation worker started.");

        // Sweep immediately on startup so jobs left Processing by a previous crash are
        // recovered before we start draining the queue.
        var nextSweep = DateTimeOffset.MinValue;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = services.CreateScope();
                var processor = scope.ServiceProvider.GetRequiredService<SeparationJobProcessor>();
                var options = scope.ServiceProvider.GetRequiredService<StemOptions>();
                var lease = TimeSpan.FromSeconds(Math.Max(1, options.ProcessingLeaseSeconds));

                // Reclaim abandoned Processing jobs on startup and once per lease window.
                if (DateTimeOffset.UtcNow >= nextSweep)
                {
                    await processor.ReclaimTimedOutJobsAsync(lease, options.MaxAttempts, stoppingToken);
                    nextSweep = DateTimeOffset.UtcNow + lease;
                }

                // Drain the queue as fast as jobs arrive; only idle when empty.
                if (!await processor.ProcessNextAsync(stoppingToken))
                {
                    await Task.Delay(IdleDelay, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Stem separation worker loop failed; backing off.");
                await Task.Delay(ErrorBackoff, stoppingToken);
            }
        }

        logger.LogInformation("Stem separation worker stopping.");
    }
}
