data "azurerm_resource_group" "web_app" {
  name = local.web_app_resource_group_name
}

data "azurerm_resource_group" "monitoring" {
  name = local.monitoring_resource_group_name
}

data "azurerm_subnet" "vnet_integration" {
  name                 = local.vnet_integration_subnet_name
  virtual_network_name = local.vnet_name
  resource_group_name  = local.vnet_resource_group_name
}

data "azurerm_subnet" "private_endpoint" {
  name                 = local.private_endpoint_subnet_name
  virtual_network_name = local.vnet_name
  resource_group_name  = local.vnet_resource_group_name
}

data "azurerm_user_assigned_identity" "managed_identity" {
  name                = local.managed_identity_name
  resource_group_name = local.managed_identity_rg
}

data "azurerm_log_analytics_workspace" "log_analytics" {
  name                = local.law_name
  resource_group_name = data.azurerm_resource_group.monitoring.name
}

data "azurerm_application_insights" "app_insights" {
  name                = local.ai_name
  resource_group_name = data.azurerm_resource_group.monitoring.name
}