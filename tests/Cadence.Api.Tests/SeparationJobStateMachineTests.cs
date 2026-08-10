using Cadence.Data.Entities;
using Cadence.Data.Stems;

namespace Cadence.Api.Tests;

/// <summary>Unit tests for the pure job lifecycle state machine.</summary>
public class SeparationJobStateMachineTests
{
    [Theory]
    [InlineData(JobStatus.Queued, JobStatus.Processing)]
    [InlineData(JobStatus.Processing, JobStatus.Completed)]
    [InlineData(JobStatus.Processing, JobStatus.Failed)]
    [InlineData(JobStatus.Processing, JobStatus.Queued)]
    public void CanTransition_AllowsLegalMoves(JobStatus from, JobStatus to) =>
        Assert.True(SeparationJobStateMachine.CanTransition(from, to));

    [Theory]
    [InlineData(JobStatus.Queued, JobStatus.Completed)]
    [InlineData(JobStatus.Queued, JobStatus.Failed)]
    [InlineData(JobStatus.Queued, JobStatus.Queued)]
    [InlineData(JobStatus.Processing, JobStatus.Processing)]
    [InlineData(JobStatus.Completed, JobStatus.Processing)]
    [InlineData(JobStatus.Completed, JobStatus.Failed)]
    [InlineData(JobStatus.Completed, JobStatus.Queued)]
    [InlineData(JobStatus.Failed, JobStatus.Processing)]
    [InlineData(JobStatus.Failed, JobStatus.Completed)]
    [InlineData(JobStatus.Failed, JobStatus.Queued)]
    public void CanTransition_RejectsIllegalMoves(JobStatus from, JobStatus to) =>
        Assert.False(SeparationJobStateMachine.CanTransition(from, to));

    [Theory]
    [InlineData(JobStatus.Completed, true)]
    [InlineData(JobStatus.Failed, true)]
    [InlineData(JobStatus.Queued, false)]
    [InlineData(JobStatus.Processing, false)]
    public void IsTerminal_IsTrueOnlyForEndStates(JobStatus status, bool expected) =>
        Assert.Equal(expected, SeparationJobStateMachine.IsTerminal(status));

    [Fact]
    public void Transition_ReturnsTarget_WhenLegal() =>
        Assert.Equal(JobStatus.Completed, SeparationJobStateMachine.Transition(JobStatus.Processing, JobStatus.Completed));

    [Fact]
    public void Transition_Throws_WhenIllegal() =>
        Assert.Throws<InvalidOperationException>(() => SeparationJobStateMachine.Transition(JobStatus.Queued, JobStatus.Completed));
}
