using System.Diagnostics.CodeAnalysis;
using Cadence.Data.Stems;

namespace Cadence.SeparationWorker;

/// <summary>
/// The hosted poll loop that drives the async separation pipeline: it repeatedly
/// asks the <see cref="SeparationJobProcessor"/> to claim and process the next
/// queued job, sleeping briefly whenever the queue is empty. The processor holds a
/// scoped <c>DbContext</c>, so a fresh DI scope is opened per iteration.
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

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = services.CreateScope();
                var processor = scope.ServiceProvider.GetRequiredService<SeparationJobProcessor>();

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
