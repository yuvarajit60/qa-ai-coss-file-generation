###############################################################
# Pipeline-driven values are replaced by the ADO token task.   #
# Scaffold-time naming values are rendered by Backstage.       #
###############################################################

subscription_id = "__subscription_id__"
environment     = "__environment__"
location        = "__location__"
os_type         = "Linux"
runtime_stack     = "python"
health_check_path = "/health"

instance_number = "01"
staging_slot_enabled = false

app_service_plan_sku                    = "__app_service_plan_sku__"
app_service_plan_worker_count           = __app_service_plan_worker_count__
app_service_plan_zone_balancing_enabled = __app_service_plan_zone_balancing_enabled__
