locals {
  # Uses the Web App naming inputs with "asp" in place of "wa".
  app_service_plan_name = format("rm-%s-etp-%s-asptestdatagen%s", local.location_prefix, var.environment, var.instance_number)
  app_service_plan_id   = module.app_service_plan.id
}

variable "app_service_plan_sku" {
  description = "SKU of the new App Service Plan, e.g. P0v3."
  type        = string
  default     = "P0v3"
}

variable "app_service_plan_worker_count" {
  description = "Number of App Service Plan instances."
  type        = number
  default     = 1

  validation {
    condition     = var.app_service_plan_worker_count >= 1
    error_message = "app_service_plan_worker_count must be at least 1."
  }
}

variable "app_service_plan_zone_balancing_enabled" {
  description = "Spread instances across availability zones."
  type        = bool
  default     = false

  validation {
    condition     = !var.app_service_plan_zone_balancing_enabled || (can(regex("^P[0-9]+m?v[234]$", var.app_service_plan_sku)) && var.app_service_plan_worker_count >= 2)
    error_message = "Zone redundancy needs a Premium v2-v4 SKU and at least 2 workers."
  }
}