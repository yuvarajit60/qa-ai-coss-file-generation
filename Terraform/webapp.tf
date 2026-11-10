module "web_app" {
  source  = "terraform.cloudsmith.io/royalmail/app-service/azurerm"
  version = "~> 1.0"

  name                     = local.web_app_name
  kind                     = "webapp"
  location                 = var.location
  parent_id                = data.azurerm_resource_group.web_app.id
  os_type                  = var.os_type
  service_plan_resource_id = local.app_service_plan_id

  virtual_network_subnet_id        = data.azurerm_subnet.vnet_integration.id
  vnet_route_all_traffic           = true
  vnet_application_traffic_enabled = true

  public_network_access_enabled            = var.public_network_access_enabled
  scm_publish_basic_authentication_enabled = false

  private_endpoints = {
    webapp = {
      name               = "${local.web_app_name}-pe"
      subnet_resource_id = data.azurerm_subnet.private_endpoint.id
    }
  }

  deployment_slots = var.staging_slot_enabled ? {
    staging = {
      name                             = "staging"
      virtual_network_subnet_id        = data.azurerm_subnet.vnet_integration.id
      vnet_route_all_traffic           = true
      vnet_application_traffic_enabled = true
      site_config                      = local.site_config
      managed_identities = {
        user_assigned_resource_ids = [data.azurerm_user_assigned_identity.managed_identity.id]
      }
    }
  } : {}

  slot_sensitive_app_settings = var.staging_slot_enabled ? { staging = local.app_settings } : {}

  managed_identities = {
    user_assigned_resource_ids = [data.azurerm_user_assigned_identity.managed_identity.id]
  }

  site_config = local.site_config

  app_settings = local.app_settings

  diagnostic_settings = {
    law = {
      name                  = "${local.web_app_name}-diag"
      workspace_resource_id = data.azurerm_log_analytics_workspace.log_analytics.id
      logs                  = [{ category_group = "allLogs" }]
      metrics               = [{ category = "AllMetrics" }]
    }
  }

  tags             = local.tags
  enable_telemetry = false
}
