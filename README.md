# .NET 10 Web App Skeleton

This is a scaffolded .NET 10 ASP.NET Core web application template.

## Structure

- **src/** - Main application code
  - `App.csproj` - Project file
  - `Program.cs` - Application startup
  - `appsettings.json` - Configuration
  - `appsettings.Development.json` - Development-specific configuration
  - `Pages/` - Razor Pages (UI)
  - `wwwroot/` - Static web assets (CSS, JS, client libraries)
  - `Properties/launchSettings.json` - Launch profiles

## Features

- .NET 10 LTS
- ASP.NET Core Razor Pages web app (`dotnet new webapp`)
- Static web assets with `MapStaticAssets`
- Development and Production configurations
- `.slnx` XML solution format (default in .NET 10)

## Getting Started

```bash
# Restore dependencies
dotnet restore

# Run the application
dotnet run

# Build for production
dotnet publish -c Release
```

## Configuration

Edit `appsettings.json` to configure the application. Environment-specific settings are loaded from `appsettings.{ASPNETCORE_ENVIRONMENT}.json`.
