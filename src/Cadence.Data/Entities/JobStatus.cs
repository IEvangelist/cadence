namespace Cadence.Data.Entities;

/// <summary>
/// Lifecycle of a <see cref="SeparationJob"/>. The valid transitions are encoded
/// in <see cref="Cadence.Data.Stems.SeparationJobStateMachine"/>: a job starts
/// <see cref="Queued"/>, is claimed into <see cref="Processing"/>, and ends in a
/// terminal <see cref="Completed"/> or <see cref="Failed"/> state.
/// </summary>
public enum JobStatus
{
    /// <summary>Persisted and awaiting a worker to claim it.</summary>
    Queued = 0,

    /// <summary>Claimed by a worker and actively separating.</summary>
    Processing = 1,

    /// <summary>All stems separated and stored.</summary>
    Completed = 2,

    /// <summary>Separation failed; <see cref="SeparationJob.ErrorMessage"/> explains why.</summary>
    Failed = 3,
}
