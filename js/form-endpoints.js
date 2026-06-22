/**
 * Ravonics form endpoints (deploy-time generated; NOT in source control).
 *
 * Injected by scripts/inject-endpoints.sh at publish time. In proxy mode these
 * are the lead-capture proxy paths (no SAS in the browser). In direct mode they
 * are the Azure Logic App SAS callback URLs. careers is intentionally absent
 * (no backend) so that form stays on its mailto fallback.
 */
window.RAVONICS_FORM_ENDPOINTS = {
  contact: "https://ravonics-lead-proxy.azurewebsites.net/api/lead/contact",
  booking: "https://ravonics-lead-proxy.azurewebsites.net/api/lead/booking",
  capability_update: "https://ravonics-lead-proxy.azurewebsites.net/api/lead/capability_update"
};
