using Cadence.Data.Entities;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;

namespace Cadence.Api;

/// <summary>
/// Defense-in-depth against a request captured under one cookie session being
/// replayed after the browser switches accounts. The optional header is never
/// trusted for authorization; it must match the server-resolved authenticated
/// user or the mutation is rejected before its endpoint runs.
/// </summary>
public static class ExpectedOwnerGuard
{
    public const string HeaderName = "X-Cadence-Expected-Owner";

    public static IApplicationBuilder UseExpectedOwnerGuard(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            if (IsMutation(context.Request.Method) &&
                context.Request.Headers.TryGetValue(HeaderName, out var expected) &&
                context.User.Identity?.IsAuthenticated == true)
            {
                var users = context.RequestServices.GetRequiredService<UserManager<ApplicationUser>>();
                var actual = users.GetUserId(context.User);
                if (expected.Count != 1 ||
                    string.IsNullOrEmpty(actual) ||
                    !string.Equals(expected[0], actual, StringComparison.Ordinal))
                {
                    context.Response.StatusCode = StatusCodes.Status409Conflict;
                    await context.Response.WriteAsJsonAsync(new
                    {
                        type = "https://cadence.app/problems/auth-owner-changed",
                        title = "The authenticated account changed before this request completed.",
                        status = StatusCodes.Status409Conflict,
                    });
                    return;
                }
            }

            await next(context);
        });

    private static bool IsMutation(string method) =>
        HttpMethods.IsPost(method) ||
        HttpMethods.IsPut(method) ||
        HttpMethods.IsPatch(method) ||
        HttpMethods.IsDelete(method);
}
