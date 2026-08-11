using System.Threading.Channels;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Cadence.Api;

/// <summary>
/// Queues an account-email job to run off the request thread.
/// <para>
/// This is the timing-side-channel defense for the auth send paths (#77): the
/// request handler enqueues a job and returns immediately, so the work it performs
/// on the hot path is identical whether or not the target address has an account.
/// The account lookup, token generation, and network send all happen later on the
/// dispatcher, where their duration can no longer be observed by the caller.
/// </para>
/// </summary>
public interface IAccountEmailQueue
{
    /// <summary>
    /// Enqueue <paramref name="job"/>. It runs later inside a fresh DI scope; the
    /// provided <see cref="IServiceProvider"/> is that scope, so the job must
    /// resolve any scoped services (e.g. <c>UserManager</c>) from it rather than
    /// capturing request-scoped services.
    /// </summary>
    void Enqueue(Func<IServiceProvider, CancellationToken, Task> job);
}

/// <summary>
/// A single-consumer background dispatcher for <see cref="IAccountEmailQueue"/>
/// jobs, backed by an unbounded channel. Registered once and exposed as both the
/// queue and an <see cref="IHostedService"/>.
/// </summary>
public sealed class AccountEmailDispatcher(
    IServiceScopeFactory scopeFactory,
    ILogger<AccountEmailDispatcher> logger) : BackgroundService, IAccountEmailQueue
{
    private readonly Channel<Func<IServiceProvider, CancellationToken, Task>> _channel =
        Channel.CreateUnbounded<Func<IServiceProvider, CancellationToken, Task>>(
            new UnboundedChannelOptions { SingleReader = true });

    // Pending = enqueued-but-not-yet-finished jobs. Tracked so tests can await a
    // quiescent point (WaitForIdleAsync) before asserting on side effects that the
    // request path now performs asynchronously.
    private readonly object _idleLock = new();
    private int _pending;
    private int _enqueuedCount;
    private TaskCompletionSource _idle = CreateCompletedIdleSource();

    /// <summary>
    /// Total jobs ever enqueued. Test-only observability used to prove that the
    /// magic-link send path enqueues identical work for known and unknown addresses
    /// (the #77 timing-side-channel defense).
    /// </summary>
    public int EnqueuedCount => Volatile.Read(ref _enqueuedCount);

    /// <inheritdoc />
    public void Enqueue(Func<IServiceProvider, CancellationToken, Task> job)
    {
        Interlocked.Increment(ref _enqueuedCount);
        lock (_idleLock)
        {
            if (_pending++ == 0)
            {
                _idle = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            }
        }

        if (!_channel.Writer.TryWrite(job))
        {
            // The channel is unbounded and only completes on shutdown, so a failed
            // write means we're stopping; undo the pending bump.
            MarkJobFinished();
        }
    }

    /// <summary>
    /// Completes once every job enqueued so far has finished (or immediately when
    /// the queue is idle). Test-only synchronization; production never awaits it.
    /// </summary>
    public Task WaitForIdleAsync(TimeSpan? timeout = null)
    {
        Task idleTask;
        lock (_idleLock)
        {
            idleTask = _pending == 0 ? Task.CompletedTask : _idle.Task;
        }

        return timeout is { } value ? idleTask.WaitAsync(value) : idleTask;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var job in _channel.Reader.ReadAllAsync(stoppingToken).ConfigureAwait(false))
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                await job(scope.ServiceProvider, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                MarkJobFinished();
                break;
            }
            catch (Exception exception)
            {
                // A failed email must never take the dispatcher down; log and move on.
                logger.LogError(exception, "Account-email job failed.");
            }

            MarkJobFinished();
        }
    }

    private void MarkJobFinished()
    {
        lock (_idleLock)
        {
            if (_pending > 0 && --_pending == 0)
            {
                _idle.TrySetResult();
            }
        }
    }

    private static TaskCompletionSource CreateCompletedIdleSource()
    {
        var source = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        source.SetResult();
        return source;
    }
}
