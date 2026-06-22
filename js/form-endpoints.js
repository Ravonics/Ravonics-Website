/**
 * Ravonics form endpoints (deploy-time generated; NOT in source control).
 *
 * Injected by scripts/inject-endpoints.sh at publish time. Defines the Azure
 * Logic App callback URLs the public forms POST to. careers is intentionally
 * absent (no backend) so that form stays on its mailto fallback.
 *
 * SAS rotated 2026-06-22 (regenerateAccessKey on both Logic Apps).
 * Old consultation sig: mj6El6caqZ0C0PSYVMswT25WYZ7yVZZNtNLLXC8CVrs
 * Old capability sig:   MHS-OOwgWMSCU5JTZHLec2LPfVswzvNUYBvYeRbPSl4
 */
window.RAVONICS_FORM_ENDPOINTS = {
  contact: "https://prod-52.eastus.logic.azure.com:443/workflows/fb6f71d5a0bb4877ae442dbbcfe5b1eb/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=9EHH2cZUoFuL6jFr2sArjUFWLupAT-0Jc1g61bd7Avw",
  booking: "https://prod-52.eastus.logic.azure.com:443/workflows/fb6f71d5a0bb4877ae442dbbcfe5b1eb/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=9EHH2cZUoFuL6jFr2sArjUFWLupAT-0Jc1g61bd7Avw",
  capability_update: "https://prod-92.eastus.logic.azure.com:443/workflows/97975454837a4cb4b30153b576537062/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=PrLRSmmRSL3hnYRVaF1LHScflcQfo6Q8CR6Drfg8UQU"
};
