using Cadence.Data;
using Cadence.Data.Stems;
using Cadence.SeparationWorker;
using Microsoft.Extensions.Options;

var builder = Host.CreateApplicationBuilder(args);

// Aspire service defaults: telemetry, health checks, service discovery, resilience.
builder.AddServiceDefaults();

// Aspire client integrations bind to the same "cadencedb" and "blobs" resources
// the API uses, so the worker reads queued jobs and writes stems to shared storage.
builder.AddNpgsqlDbContext<CadenceDbContext>("cadencedb");
builder.AddAzureBlobServiceClient("blobs");

// Stem options (bound lazily so nothing here is required for a local run) plus the
// Blob-backed stem storage the pipeline persists mixes and stems through.
builder.Services.Configure<StemOptions>(builder.Configuration.GetSection(StemOptions.SectionName));
builder.Services.AddSingleton(sp => sp.GetRequiredService<IOptions<StemOptions>>().Value);
builder.Services.AddSingleton<IStemStorage, BlobStemStorage>();

// Engine selection: when a pinned model is configured the worker runs the ONNX
// (Demucs) separator; otherwise it uses the deterministic band-split reference
// engine, so the whole pipeline still works locally and in CI without a model.
var stemOptions = builder.Configuration.GetSection(StemOptions.SectionName).Get<StemOptions>() ?? new StemOptions();
if (!string.IsNullOrWhiteSpace(stemOptions.ModelUri))
{
    builder.Services.AddHttpClient<IStemModelProvider, HttpStemModelProvider>();
    builder.Services.AddSingleton<IStemSeparator, OnnxStemSeparator>();
}
else
{
    builder.Services.AddSingleton<IStemSeparator>(new BandSplitStemSeparator());
}

// The processor is scoped (it holds the scoped DbContext); the hosted loop opens a
// fresh scope per job so one failure never poisons a shared context.
builder.Services.AddScoped<SeparationJobProcessor>();
builder.Services.AddHostedService<SeparationBackgroundService>();

builder.Build().Run();
