module "app_service_plan" {
  source  = "terraform.cloudsmith.io/royalmail/web-serverfarm/azurerm"
  version = "~> 1.1"

  name                   = local.app_service_plan_name
  location               = var.location
  resource_group_name    = data.azurerm_resource_group.web_app.name
  os_type                = var.os_type
  sku_name               = var.app_service_plan_sku
  worker_count           = var.app_service_plan_worker_count
  zone_balancing_enabled = var.app_service_plan_zone_balancing_enabled
  enable_telemetry       = false

  tags = local.tags
}