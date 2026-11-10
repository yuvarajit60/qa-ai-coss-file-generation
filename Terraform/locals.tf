locals {
  # Shared region and naming context
  location_prefix = lookup(var.location_prefix_map, replace(lower(var.location), " ", ""), "agw")

  # Names below are rendered by Roadie; the %s values are the location prefix and environment.

  # Web App
  web_app_resource_group_name = format("rm-%s-etp-%s-rg-shared02", local.location_prefix, var.environment)
  web_app_name                = format("rm-%s-etp-%s-watestdatagen%s", local.location_prefix, var.environment, var.instance_number)

  # Existing VNet and subnets
  vnet_resource_group_name     = format("rm-%s-etp-%s-rg-net01", local.location_prefix, var.environment)
  vnet_name                    = format("rm-%s-etp-%s-vn01", local.location_prefix, var.environment)
  vnet_integration_subnet_name = format("rm-%s-etp-%s-vn01-sninteg-01", local.location_prefix, var.environment)
  private_endpoint_subnet_name = format("rm-%s-etp-%s-vn01-snprivend-01", local.location_prefix, var.environment)

  # User-assigned managed identity
  managed_identity_rg   = format("rm-%s-etp-%s-rg-mi01", local.location_prefix, var.environment)
  managed_identity_name = format("rm-%s-etp-%s-miapp01", local.location_prefix, var.environment)

  # Monitoring resources
  monitoring_resource_group_name = format("rm-%s-etp-%s-rg-ops01", local.location_prefix, var.environment)
  law_name                       = format("rm-%s-etp-%s-la01", local.location_prefix, var.environment)
  ai_name                        = format("rm-%s-etp-%s-ai01", local.location_prefix, var.environment)


  # Web App identity and runtime settings
  identity_client_id = data.azurerm_user_assigned_identity.managed_identity.client_id

  application_stack = {
    dotnet = var.runtime_stack == "dotnet" ? merge(
      { dotnet_version = var.os_type == "Windows" ? "v${var.dotnet_version}" : var.dotnet_version },
      var.os_type == "Windows" ? { current_stack = "dotnet" } : {},
    ) : null
    node   = var.runtime_stack == "node" ? { node_version = var.node_version } : null
    python = var.runtime_stack == "python" ? { python_version = var.python_version } : null
  }

  app_command_line = {
    # Next.js standalone output is started by its generated server.js.
    node = "node server.js"
    # FastAPI app (main.py) served by gunicorn with uvicorn workers; agent calls can run for minutes.
    python = "gunicorn -k uvicorn.workers.UvicornWorker --workers 1 --bind=0.0.0.0:8000 --timeout 600 main:app"
  }

  site_config = {
    always_on              = true
    health_check_path      = var.health_check_path
    vnet_route_all_enabled = true
    application_stack      = local.application_stack
    app_command_line       = lookup(local.app_command_line, var.runtime_stack, null)
  }

  app_insights_settings = merge(
    {
      APPLICATIONINSIGHTS_CONNECTION_STRING      = sensitive(data.azurerm_application_insights.app_insights.connection_string)
      ApplicationInsightsAgent_EXTENSION_VERSION = var.os_type == "Windows" ? "~2" : "~3"
    },
    var.app_insights_entra_auth_enabled ? {
      APPLICATIONINSIGHTS_AUTHENTICATION_STRING = "Authorization=AAD;ClientId=${local.identity_client_id}"
    } : {},
  )

  app_settings = merge(
    { AZURE_CLIENT_ID = local.identity_client_id },
    var.runtime_stack == "node" ? {
      HOSTNAME                       = "0.0.0.0"
      SCM_DO_BUILD_DURING_DEPLOYMENT = "false"
    } : {},
    # Oryx installs requirements.txt during zip deploy
    var.runtime_stack == "python" ? {
      SCM_DO_BUILD_DURING_DEPLOYMENT = "true"
    } : {},
    local.app_insights_settings,
    var.app_settings,
  )

  tags = merge(
    {
      Environment = var.environment
      ManagedBy   = "Terraform"
      Project     = "etp"
    },
    var.tags,
  )
}