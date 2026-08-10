using System.Collections.Concurrent;
using System.Diagnostics.Metrics;
using System.Net;
using System.Net.Http.Json;
using Cadence.ServiceDefaults;

namespace Cadence.Api.Tests;

public class CadenceTelemetryMetricsTests
{
    [Fact]
    public async Task LoginFailure_RecordsUnauthorizedAuthOperationAndDuration()
    {
        var measurements = new ConcurrentQueue<RecordedMeasurement>();
        using var listener = new MeterListener();

        listener.InstrumentPublished = (instrument, meterListener) =>
        {
            if (instrument.Meter.Name == CadenceTelemetry.MeterName)
            {
                meterListener.EnableMeasurementEvents(instrument);
            }
        };

        listener.SetMeasurementEventCallback<long>((instrument, _, tags, _) =>
            measurements.Enqueue(new RecordedMeasurement(instrument.Name, tags.ToArray())));
        listener.SetMeasurementEventCallback<double>((instrument, _, tags, _) =>
            measurements.Enqueue(new RecordedMeasurement(instrument.Name, tags.ToArray())));
        listener.Start();

        await using var factory = new CadenceApiFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { Email = "telemetry.missing@example.com", Password = "Wrong0rd!" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains(
            measurements,
            measurement =>
                measurement.InstrumentName == "cadence.auth.operations" &&
                HasTag(measurement, "operation", "login") &&
                HasTag(measurement, "outcome", "unauthorized") &&
                HasTag(measurement, "http.status_code", "401"));
        Assert.Contains(
            measurements,
            measurement =>
                measurement.InstrumentName == "cadence.request.duration" &&
                HasTag(measurement, "flow", "auth") &&
                HasTag(measurement, "operation", "login") &&
                HasTag(measurement, "outcome", "unauthorized"));
    }

    private static bool HasTag(RecordedMeasurement measurement, string key, string value) =>
        measurement.Tags.Any(tag =>
            tag.Key == key &&
            string.Equals(tag.Value?.ToString(), value, StringComparison.Ordinal));

    private sealed record RecordedMeasurement(
        string InstrumentName,
        KeyValuePair<string, object?>[] Tags);
}
