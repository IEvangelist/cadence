using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using StackExchange.Redis;

namespace Cadence.Api.Collaboration;

public enum CollabRevocationKind
{
    Grant,
    User,
}

public sealed record CollabRevocationMessage(
    CollabRevocationKind Kind,
    string ScopeId,
    long Generation);

public interface ICollabRevocationBus
{
    event Func<CollabRevocationMessage, Task>? Revoked;
    string GrantId(string token);
    Task<long> GetGrantGenerationAsync(string grantId);
    Task<long> GetUserGenerationAsync(string callerId);
    Task<T> WithGrantBarrierAsync<T>(string grantId, Func<Task<T>> action);
    Task<T> WithUserBarrierAsync<T>(string callerId, Func<Task<T>> action);
    Task<long> RevokeGrantAsync(string grantId);
    Task<long> RevokeUserAsync(string callerId);
}

public sealed class InMemoryCollabRevocationBus : ICollabRevocationBus
{
    private readonly ConcurrentDictionary<string, long> _grants = new();
    private readonly ConcurrentDictionary<string, long> _users = new();
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new();

    public event Func<CollabRevocationMessage, Task>? Revoked;

    public string GrantId(string token) => Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public Task<long> GetGrantGenerationAsync(string grantId) =>
        Task.FromResult(_grants.GetValueOrDefault(grantId));

    public Task<long> GetUserGenerationAsync(string callerId) =>
        Task.FromResult(_users.GetValueOrDefault(callerId));

    public Task<T> WithGrantBarrierAsync<T>(string grantId, Func<Task<T>> action) =>
        WithBarrierAsync($"grant:{grantId}", action);

    public Task<T> WithUserBarrierAsync<T>(string callerId, Func<Task<T>> action) =>
        WithBarrierAsync($"user:{callerId}", action);

    public async Task<long> RevokeGrantAsync(string grantId)
    {
        var generation = _grants.AddOrUpdate(grantId, 1, static (_, value) => value + 1);
        await DispatchAsync(new(CollabRevocationKind.Grant, grantId, generation));
        return generation;
    }

    public async Task<long> RevokeUserAsync(string callerId)
    {
        var generation = _users.AddOrUpdate(callerId, 1, static (_, value) => value + 1);
        await DispatchAsync(new(CollabRevocationKind.User, callerId, generation));
        return generation;
    }

    private async Task<T> WithBarrierAsync<T>(string key, Func<Task<T>> action)
    {
        var gate = _locks.GetOrAdd(key, static _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        try
        {
            return await action();
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task DispatchAsync(CollabRevocationMessage message)
    {
        var handlers = Revoked?.GetInvocationList()
            .Cast<Func<CollabRevocationMessage, Task>>()
            .ToArray() ?? [];
        await Task.WhenAll(handlers.Select(handler => handler(message)));
    }
}

public sealed class RedisCollabRevocationBus(
    IConnectionMultiplexer redis,
    ILogger<RedisCollabRevocationBus> logger)
    : BackgroundService, ICollabRevocationBus
{
    private static readonly RedisChannel Channel =
        RedisChannel.Literal("cadence:collab:revocations:v1");
    private readonly IDatabase _database = redis.GetDatabase();
    private readonly ISubscriber _subscriber = redis.GetSubscriber();

    public event Func<CollabRevocationMessage, Task>? Revoked;

    public string GrantId(string token) => Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public async Task<long> GetGrantGenerationAsync(string grantId)
    {
        var value = await _database.StringGetAsync(GenerationKey("grant", grantId));
        return value.HasValue ? (long)value : 0;
    }

    public async Task<long> GetUserGenerationAsync(string callerId)
    {
        var value = await _database.StringGetAsync(GenerationKey("user", callerId));
        return value.HasValue ? (long)value : 0;
    }

    public Task<T> WithGrantBarrierAsync<T>(string grantId, Func<Task<T>> action) =>
        WithBarrierAsync($"grant:{grantId}", action);

    public Task<T> WithUserBarrierAsync<T>(string callerId, Func<Task<T>> action) =>
        WithBarrierAsync($"user:{callerId}", action);

    public async Task<long> RevokeGrantAsync(string grantId)
    {
        var generation = await _database.StringIncrementAsync(
            GenerationKey("grant", grantId));
        await PublishAsync(new(CollabRevocationKind.Grant, grantId, generation));
        return generation;
    }

    public async Task<long> RevokeUserAsync(string callerId)
    {
        var generation = await _database.StringIncrementAsync(
            GenerationKey("user", callerId));
        await PublishAsync(new(CollabRevocationKind.User, callerId, generation));
        return generation;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await _subscriber.SubscribeAsync(Channel, (_channel, value) =>
                {
                    _ = DispatchJsonAsync(value!);
                });
                await Task.Delay(Timeout.Infinite, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Collaboration revocation subscription failed; retrying.");
                await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
            }
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        await _subscriber.UnsubscribeAsync(Channel);
        await base.StopAsync(cancellationToken);
    }

    private async Task<T> WithBarrierAsync<T>(string scope, Func<Task<T>> action)
    {
        var key = $"cadence:collab:lock:{scope}";
        var token = Guid.NewGuid().ToString("N");
        while (!await _database.LockTakeAsync(key, token, TimeSpan.FromSeconds(30)))
        {
            await Task.Delay(25);
        }
        try
        {
            return await action();
        }
        finally
        {
            await _database.LockReleaseAsync(key, token);
        }
    }

    private async Task PublishAsync(CollabRevocationMessage message)
    {
        await _subscriber.PublishAsync(Channel, JsonSerializer.Serialize(message));
        await DispatchAsync(message);
    }

    private async Task DispatchJsonAsync(string value)
    {
        try
        {
            var message = JsonSerializer.Deserialize<CollabRevocationMessage>(value);
            if (message is not null) await DispatchAsync(message);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Ignored malformed collaboration revocation message.");
        }
    }

    private async Task DispatchAsync(CollabRevocationMessage message)
    {
        var handlers = Revoked?.GetInvocationList()
            .Cast<Func<CollabRevocationMessage, Task>>()
            .ToArray() ?? [];
        await Task.WhenAll(handlers.Select(handler => handler(message)));
    }

    private static string GenerationKey(string kind, string scope) =>
        $"cadence:collab:generation:{kind}:{scope}";
}

public static class CollabRevocationRegistration
{
    public static IHostApplicationBuilder AddCollabRevocation(this IHostApplicationBuilder builder)
    {
        if (!string.IsNullOrWhiteSpace(
                builder.Configuration.GetConnectionString("redis")))
        {
            builder.Services.AddSingleton<RedisCollabRevocationBus>();
            builder.Services.AddSingleton<ICollabRevocationBus>(
                services => services.GetRequiredService<RedisCollabRevocationBus>());
            builder.Services.AddHostedService(
                services => services.GetRequiredService<RedisCollabRevocationBus>());
        }
        else
        {
            builder.Services.AddSingleton<ICollabRevocationBus, InMemoryCollabRevocationBus>();
        }
        return builder;
    }
}
