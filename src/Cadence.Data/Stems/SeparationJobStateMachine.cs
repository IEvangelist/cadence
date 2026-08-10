using Cadence.Data.Entities;

namespace Cadence.Data.Stems;

/// <summary>
/// The authoritative, pure state machine for a <see cref="SeparationJob"/>'s
/// lifecycle. Keeping the legal transitions in one place (rather than scattered
/// <c>if</c>s) makes the pipeline auditable and trivially unit-testable, and stops
/// the worker from ever resurrecting a terminal job.
/// </summary>
public static class SeparationJobStateMachine
{
    /// <summary>Whether <paramref name="to"/> is a legal next state from <paramref name="from"/>.</summary>
    public static bool CanTransition(JobStatus from, JobStatus to) => (from, to) switch
    {
        (JobStatus.Queued, JobStatus.Processing) => true,
        (JobStatus.Processing, JobStatus.Completed) => true,
        (JobStatus.Processing, JobStatus.Failed) => true,
        // Reclaim: a stuck job whose processing lease expired is returned to the
        // queue for another attempt (the reaper caps this via the attempt count).
        (JobStatus.Processing, JobStatus.Queued) => true,
        _ => false,
    };

    /// <summary>True for the terminal states (<see cref="JobStatus.Completed"/>/<see cref="JobStatus.Failed"/>).</summary>
    public static bool IsTerminal(JobStatus status) =>
        status is JobStatus.Completed or JobStatus.Failed;

    /// <summary>
    /// Return <paramref name="to"/> if the transition is legal, otherwise throw.
    /// Callers assign the result back to the job's status.
    /// </summary>
    /// <exception cref="InvalidOperationException">The transition is not allowed.</exception>
    public static JobStatus Transition(JobStatus from, JobStatus to) =>
        CanTransition(from, to)
            ? to
            : throw new InvalidOperationException($"Illegal job transition {from} -> {to}.");
}
