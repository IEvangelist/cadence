using Microsoft.Extensions.Options;

namespace Cadence.Data.Stems;

/// <summary>Fail-fast validation shared by the API and separation worker.</summary>
public sealed class StemOptionsValidator(bool isProduction) : IValidateOptions<StemOptions>
{
    /// <inheritdoc />
    public ValidateOptionsResult Validate(string? name, StemOptions options)
    {
        var failures = new List<string>();

        AddPositiveFailure(options.MaxUploadBytes, nameof(StemOptions.MaxUploadBytes), failures);
        AddPositiveFailure(options.MaxDurationSeconds, nameof(StemOptions.MaxDurationSeconds), failures);
        AddPositiveFailure(options.ProcessingLeaseSeconds, nameof(StemOptions.ProcessingLeaseSeconds), failures);
        AddPositiveFailure(options.MaxAttempts, nameof(StemOptions.MaxAttempts), failures);

        var modelUri = NullIfWhiteSpace(options.ModelUri);
        var checksum = NullIfWhiteSpace(options.ModelSha256);

        if (modelUri is null)
        {
            if (checksum is not null)
            {
                failures.Add("Stems:ModelSha256 requires Stems:ModelUri.");
            }
        }
        else
        {
            try
            {
                StemModelIntegrity.RequireSecureModelUri(modelUri);
            }
            catch (InvalidOperationException exception)
            {
                failures.Add(exception.Message);
            }

            if (checksum is not null && !StemModelIntegrity.IsValidSha256(checksum))
            {
                failures.Add("Stems:ModelSha256 must be a 64-digit hexadecimal SHA-256 digest.");
            }

            if (isProduction && IsRemoteHttpsUri(modelUri) && checksum is null)
            {
                failures.Add("Stems:ModelSha256 is required for a remote production model.");
            }
        }

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }

    private static void AddPositiveFailure(long value, string propertyName, ICollection<string> failures)
    {
        if (value <= 0)
        {
            failures.Add($"Stems:{propertyName} must be greater than zero.");
        }
    }

    private static string? NullIfWhiteSpace(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static bool IsRemoteHttpsUri(string uri) =>
        Uri.TryCreate(uri, UriKind.Absolute, out var parsed) &&
        string.Equals(parsed.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase);
}
