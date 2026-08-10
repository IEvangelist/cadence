using System.Diagnostics;
using System.Diagnostics.Metrics;
using Cadence.ServiceDefaults;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

// Centralizes Cadence's custom request telemetry so domain flows are consistent across services.
namespace Cadence.ServiceDefaults
{
    public static class CadenceTelemetry
    {
        public const string MeterName = "Cadence";
        public const string ActivitySourceName = "Cadence";

        private const string AuthFlow = "auth";
        private const string ProjectsFlow = "projects";
        private const string BillingFlow = "billing";
        private const string ProjectsPathPrefix = "/api/projects/";
        private const string ExternalPathPrefix = "/api/auth/external/";

        public static readonly Meter Meter = new(MeterName);
        public static readonly ActivitySource ActivitySource = new(ActivitySourceName);

        private static readonly Counter<long> AuthOperations = Meter.CreateCounter<long>(
            "cadence.auth.operations",
            description: "Count of authentication operations by outcome.");

        private static readonly Counter<long> ProjectOperations = Meter.CreateCounter<long>(
            "cadence.projects.operations",
            description: "Count of project operations by outcome.");

        private static readonly Counter<long> BillingOperations = Meter.CreateCounter<long>(
            "cadence.billing.operations",
            description: "Count of billing operations by outcome.");

        private static readonly Histogram<double> RequestDuration = Meter.CreateHistogram<double>(
            "cadence.request.duration",
            unit: "ms",
            description: "Duration of classified Cadence request flows.");

        private static readonly UpDownCounter<long> ActiveRequests = Meter.CreateUpDownCounter<long>(
            "cadence.requests.active",
            description: "In-flight classified Cadence requests.");

        public static CadenceFlow? Classify(PathString path, string httpMethod)
        {
            if (path.Value is not { } value)
            {
                return null;
            }

            if (HttpMethods.IsPost(httpMethod))
            {
                if (MatchesPath(value, "/api/auth/register"))
                {
                    return new CadenceFlow(AuthFlow, "register");
                }

                if (MatchesPath(value, "/api/auth/login"))
                {
                    return new CadenceFlow(AuthFlow, "login");
                }

                if (MatchesPath(value, "/api/auth/logout"))
                {
                    return new CadenceFlow(AuthFlow, "logout");
                }

                if (MatchesPath(value, "/api/auth/magic-link"))
                {
                    return new CadenceFlow(AuthFlow, "magic_link_request");
                }

                if (MatchesPath(value, "/api/projects"))
                {
                    return new CadenceFlow(ProjectsFlow, "create");
                }

                if (MatchesPath(value, "/api/billing/checkout"))
                {
                    return new CadenceFlow(BillingFlow, "checkout");
                }

                if (MatchesPath(value, "/api/billing/portal"))
                {
                    return new CadenceFlow(BillingFlow, "portal");
                }

                if (MatchesPath(value, "/api/billing/webhook"))
                {
                    return new CadenceFlow(BillingFlow, "webhook");
                }
            }

            if (HttpMethods.IsGet(httpMethod))
            {
                if (MatchesPath(value, "/api/auth/me"))
                {
                    return new CadenceFlow(AuthFlow, "me");
                }

                if (MatchesPath(value, "/api/auth/magic-link/verify"))
                {
                    return new CadenceFlow(AuthFlow, "magic_link_verify");
                }

                if (MatchesPath(value, "/api/auth/external/callback"))
                {
                    return new CadenceFlow(AuthFlow, "external_callback");
                }

                if (HasSingleSegment(value, ExternalPathPrefix))
                {
                    return new CadenceFlow(AuthFlow, "external_challenge");
                }

                if (MatchesPath(value, "/api/auth/providers"))
                {
                    return new CadenceFlow(AuthFlow, "providers");
                }

                if (MatchesPath(value, "/api/projects"))
                {
                    return new CadenceFlow(ProjectsFlow, "list");
                }

                if (HasSingleSegment(value, ProjectsPathPrefix))
                {
                    return new CadenceFlow(ProjectsFlow, "get");
                }

                if (MatchesPath(value, "/api/entitlements"))
                {
                    return new CadenceFlow(BillingFlow, "entitlements");
                }
            }

            if (HttpMethods.IsPut(httpMethod) && HasSingleSegment(value, ProjectsPathPrefix))
            {
                return new CadenceFlow(ProjectsFlow, "update");
            }

            if (HttpMethods.IsDelete(httpMethod) && HasSingleSegment(value, ProjectsPathPrefix))
            {
                return new CadenceFlow(ProjectsFlow, "delete");
            }

            return null;
        }

        public static string OutcomeFor(int statusCode) =>
            statusCode switch
            {
                < 400 => "success",
                401 or 403 => "unauthorized",
                429 => "rate_limited",
                400 or 422 => "invalid",
                402 => "payment_required",
                >= 500 => "error",
                _ => "other",
            };

        public static void RecordFlow(
            CadenceFlow flow,
            string outcome,
            int statusCode,
            double elapsedMilliseconds)
        {
            var operationTags = new TagList
            {
                { "operation", flow.Operation },
                { "outcome", outcome },
                { "http.status_code", statusCode },
            };

            switch (flow.Flow)
            {
                case AuthFlow:
                    AuthOperations.Add(1, operationTags);
                    break;
                case ProjectsFlow:
                    ProjectOperations.Add(1, operationTags);
                    break;
                case BillingFlow:
                    BillingOperations.Add(1, operationTags);
                    break;
            }

            var durationTags = new TagList
            {
                { "flow", flow.Flow },
                { "operation", flow.Operation },
                { "outcome", outcome },
            };

            RequestDuration.Record(elapsedMilliseconds, durationTags);
        }

        internal static void RecordActiveRequest(CadenceFlow flow, long delta)
        {
            var tags = new TagList
            {
                { "flow", flow.Flow },
            };

            ActiveRequests.Add(delta, tags);
        }

        private static bool MatchesPath(string path, string expectedPath) =>
            string.Equals(path, expectedPath, StringComparison.OrdinalIgnoreCase) ||
            (path.Length == expectedPath.Length + 1 &&
             path[^1] == '/' &&
             path.StartsWith(expectedPath, StringComparison.OrdinalIgnoreCase));

        private static bool HasSingleSegment(string path, string prefix)
        {
            if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var segment = path.AsSpan(prefix.Length);
            if (segment.Length > 0 && segment[^1] == '/')
            {
                segment = segment[..^1];
            }

            return !segment.IsEmpty && segment.IndexOf('/') < 0;
        }
    }

    public readonly record struct CadenceFlow(string Flow, string Operation);

    public sealed class CadenceTelemetryMiddleware(
        RequestDelegate next,
        ILogger<CadenceTelemetryMiddleware> logger)
    {
        private readonly RequestDelegate _next = next;
        private readonly ILogger<CadenceTelemetryMiddleware> _logger = logger;

        public async Task InvokeAsync(HttpContext context)
        {
            var flow = CadenceTelemetry.Classify(context.Request.Path, context.Request.Method);
            if (flow is not { } classifiedFlow)
            {
                await _next(context);
                return;
            }

            using var scope = _logger.BeginScope(new Dictionary<string, object?>
            {
                ["cadence.flow"] = classifiedFlow.Flow,
                ["cadence.operation"] = classifiedFlow.Operation,
            });

            CadenceTelemetry.RecordActiveRequest(classifiedFlow, 1);
            var serverActivity = Activity.Current;
            using var activity = CadenceTelemetry.ActivitySource.StartActivity(
                $"{classifiedFlow.Flow}.{classifiedFlow.Operation}",
                ActivityKind.Internal);
            var startTimestamp = Stopwatch.GetTimestamp();

            try
            {
                await _next(context);
            }
            finally
            {
                var elapsedMilliseconds = Stopwatch.GetElapsedTime(startTimestamp).TotalMilliseconds;
                var outcome = CadenceTelemetry.OutcomeFor(context.Response.StatusCode);

                CadenceTelemetry.RecordFlow(
                    classifiedFlow,
                    outcome,
                    context.Response.StatusCode,
                    elapsedMilliseconds);

                activity?.SetTag("cadence.flow", classifiedFlow.Flow);
                activity?.SetTag("cadence.operation", classifiedFlow.Operation);
                activity?.SetTag("cadence.outcome", outcome);

                serverActivity?.SetTag("cadence.flow", classifiedFlow.Flow);
                serverActivity?.SetTag("cadence.operation", classifiedFlow.Operation);
                serverActivity?.SetTag("cadence.outcome", outcome);

                if (outcome == "error")
                {
                    activity?.SetStatus(ActivityStatusCode.Error);
                }

                CadenceTelemetry.RecordActiveRequest(classifiedFlow, -1);

                _logger.LogInformation(
                    "Cadence request flow {CadenceFlow} operation {CadenceOperation} completed with outcome {CadenceOutcome}, status {StatusCode} in {ElapsedMilliseconds} ms.",
                    classifiedFlow.Flow,
                    classifiedFlow.Operation,
                    outcome,
                    context.Response.StatusCode,
                    elapsedMilliseconds);
            }
        }
    }
}

namespace Microsoft.AspNetCore.Builder
{
    public static class CadenceTelemetryApplicationBuilderExtensions
    {
        public static IApplicationBuilder UseCadenceTelemetry(this IApplicationBuilder app) =>
            app.UseMiddleware<CadenceTelemetryMiddleware>();
    }
}
