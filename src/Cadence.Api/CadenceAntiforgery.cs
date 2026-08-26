using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;

namespace Cadence.Api;

/// <summary>Cookie/header antiforgery protection for authenticated API mutations.</summary>
public static class CadenceAntiforgery
{
    public const string HeaderName = "X-CSRF-TOKEN";
    public const string CookieName = "cadence.csrf";
    public const string InvalidTokenProblemType = "https://cadence.app/problems/invalid-csrf-token";
    public const string EnforcedConfigKey = "Security:Antiforgery:Enforced";

    public static IHostApplicationBuilder AddCadenceAntiforgery(this IHostApplicationBuilder builder)
    {
        builder.Services.AddAntiforgery();
        builder.Services.AddOptions<AntiforgeryOptions>()
            .Configure<IConfiguration, IHostEnvironment>((options, configuration, environment) =>
            {
                var (sameSite, securePolicy) = CadenceIdentityExtensions.ResolveCookiePolicy(
                    configuration[CadenceIdentityExtensions.CookieSameSiteConfigKey],
                    environment.IsDevelopment(),
                    environment.IsEnvironment("Testing"));

                options.HeaderName = HeaderName;
                options.Cookie.Name = CookieName;
                options.Cookie.HttpOnly = true;
                options.Cookie.IsEssential = true;
                options.Cookie.SameSite = sameSite;
                options.Cookie.SecurePolicy = securePolicy;
            });

        return builder;
    }

    public static IApplicationBuilder UseCadenceAntiforgery(this IApplicationBuilder app) =>
        app.UseMiddleware<CadenceAntiforgeryMiddleware>();

    private sealed class CadenceAntiforgeryMiddleware(
        RequestDelegate next,
        IAntiforgery antiforgery,
        IConfiguration configuration,
        ILogger<CadenceAntiforgeryMiddleware> logger)
    {
        public async Task InvokeAsync(HttpContext context)
        {
            var endpointRequiresAuthorization =
                context.GetEndpoint()?.Metadata.GetOrderedMetadata<IAuthorizeData>().Count > 0;

            if (endpointRequiresAuthorization &&
                IsUnsafeMethod(context.Request.Method) &&
                context.User.Identity?.IsAuthenticated is true)
            {
                try
                {
                    await antiforgery.ValidateRequestAsync(context);
                }
                catch (AntiforgeryValidationException)
                {
                    if (!configuration.GetValue(EnforcedConfigKey, true))
                    {
                        logger.LogWarning("Antiforgery validation failed in report-only mode.");
                        await next(context);
                        return;
                    }

                    logger.LogWarning("Rejected request because antiforgery validation failed.");

                    await Results.Problem(
                        statusCode: StatusCodes.Status400BadRequest,
                        title: "Invalid antiforgery token",
                        detail: "Refresh the antiforgery token and retry the request.",
                        type: InvalidTokenProblemType).ExecuteAsync(context);
                    return;
                }
            }

            await next(context);
        }

        private static bool IsUnsafeMethod(string method) =>
            HttpMethods.IsPost(method) ||
            HttpMethods.IsPut(method) ||
            HttpMethods.IsPatch(method) ||
            HttpMethods.IsDelete(method);
    }
}
