using Cadence.Api.Ai;

namespace Cadence.Api.Tests;

/// <summary>
/// Unit tests for <see cref="InMemoryAiGenerationCounter"/>, the single-node/test backing for the
/// #71 daily cap. It must count per user, isolate one user from another, and reset when the UTC
/// day rolls over — proven deterministically through the injectable clock.
/// </summary>
public class InMemoryAiGenerationCounterTests
{
    [Fact]
    public async Task Increment_AccumulatesPerUser()
    {
        var counter = new InMemoryAiGenerationCounter();

        Assert.Equal(1, await counter.IncrementTodayAsync("user-a"));
        Assert.Equal(2, await counter.IncrementTodayAsync("user-a"));
        Assert.Equal(2, await counter.GetTodayAsync("user-a"));
    }

    [Fact]
    public async Task Counts_AreIsolatedPerUser()
    {
        var counter = new InMemoryAiGenerationCounter();

        await counter.IncrementTodayAsync("user-a");
        await counter.IncrementTodayAsync("user-a");

        Assert.Equal(2, await counter.GetTodayAsync("user-a"));
        Assert.Equal(0, await counter.GetTodayAsync("user-b"));
    }

    [Fact]
    public async Task Count_ResetsOnUtcDayRollover()
    {
        var now = new DateTimeOffset(2026, 1, 1, 23, 0, 0, TimeSpan.Zero);
        var counter = new InMemoryAiGenerationCounter(() => now);

        await counter.IncrementTodayAsync("user-a");
        await counter.IncrementTodayAsync("user-a");
        Assert.Equal(2, await counter.GetTodayAsync("user-a"));

        // Advance past midnight UTC: the new day is a fresh window, so the count resets.
        now = now.AddHours(2);

        Assert.Equal(0, await counter.GetTodayAsync("user-a"));
        Assert.Equal(1, await counter.IncrementTodayAsync("user-a"));
    }
}
