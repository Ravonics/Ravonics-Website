/**
 * Ravonics form endpoints (deploy-time generated; NOT in source control).
 *
 * Injected by scripts/inject-endpoints.sh at publish time. These are the
 * lead-capture proxy paths; Logic App credentials never reach the browser.
 * careers is intentionally absent (no backend) so that form stays on its
 * mailto fallback.
 */
window.RAVONICS_FORM_ENDPOINTS = {
  contact: "https://ravonicsapi-adcah9bdahb4hca0.z02.azurefd.net/api/lead/contact",
  booking: "https://ravonicsapi-adcah9bdahb4hca0.z02.azurefd.net/api/lead/booking",
  capability_update: "https://ravonicsapi-adcah9bdahb4hca0.z02.azurefd.net/api/lead/capability_update"
};
