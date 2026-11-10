# Deployment context
variable "subscription_id" {
  description = "Azure subscription ID supplied by the pipeline."
  type        = string
}

variable "environment" {
  description = "Short environment code used in resource names."
  type        = string

  validation {
    condition     = contains(["c", "d", "q", "a", "v", "p"], var.environment)
    error_message = "environment must be one of: c, d, q, a, v, p."
  }
}

variable "location" {
  description = "Azure region, for example GermanyWestCentral."
  type        = string
}

# Shared naming inputs
variable "location_prefix_map" {
  description = "Azure region to resource-name prefix mapping."
  type        = map(string)
  default = {
    germanywestcentral = "agw"
    swedencentral      = "asc"
    northeurope        = "ne"
    westeurope         = "we"
  }
}

variable "tags" {
  description = "Additional Azure resource tags."
  type        = map(string)
  default     = {}
}

# Web App configuration
variable "instance_number" {
  description = "Two-digit Web App instance suffix."
  type        = string
  default     = "01"

  validation {
    condition     = can(regex("^[0-9]{2}$", var.instance_number))
    error_message = "instance_number must contain exactly two digits."
  }
}

variable "os_type" {
  description = "Web App OS; it must match the existing App Service Plan."
  type        = string
  default     = "Windows"

  validation {
    condition     = contains(["Linux", "Windows"], var.os_type)
    error_message = "os_type must be Linux or Windows."
  }
}

variable "runtime_stack" {
  description = "Application runtime: dotnet, node (Next.js) or python (FastAPI)."
  type        = string
  default     = "dotnet"
}

variable "dotnet_version" {
  description = ".NET runtime version, for example 10.0."
  type        = string
  default     = "10.0"
}

variable "node_version" {
  description = "Linux Node.js runtime version, for example 22-lts."
  type        = string
  default     = "22-lts"
}

variable "python_version" {
  description = "Linux Python runtime version, for example 3.11."
  type        = string
  default     = "3.11"
}

variable "health_check_path" {
  description = "HTTP path used for the App Service health check."
  type        = string
  default     = "/health"
}

variable "public_network_access_enabled" {
  description = "Whether public network access is enabled for the Web App."
  type        = bool
  default     = false
}

variable "staging_slot_enabled" {
  description = "Whether to create a staging deployment slot."
  type        = bool
  default     = false
}

variable "app_settings" {
  description = "Additional Web App settings."
  type        = map(string)
  default     = {}
  sensitive   = true
}

# Monitoring configuration
variable "app_insights_entra_auth_enabled" {
  description = "Whether the Web App authenticates Application Insights using its managed identity."
  type        = bool
  default     = false
}