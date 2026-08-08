var builder = DistributedApplication.CreateBuilder(args);

// Relational store for projects, users, and metadata.
var postgres = builder.AddPostgres("postgres");
var cadenceDb = postgres.AddDatabase("cadencedb");

// Presence, caching, and rate-limiting.
var redis = builder.AddRedis("redis");

// Audio/asset blob storage, backed by the Azurite emulator in development.
var storage = builder.AddAzureStorage("storage").RunAsEmulator();
var blobs = storage.AddBlobs("blobs");

builder.AddProject<Projects.Cadence_Api>("api")
    .WithReference(cadenceDb)
    .WaitFor(cadenceDb)
    .WithReference(redis)
    .WaitFor(redis)
    .WithReference(blobs)
    .WaitFor(blobs);

builder.Build().Run();
