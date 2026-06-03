function getAuthHeaders(credentials) {
  return { "Content-Type": "application/json" };
}
function getAuthBody(credentials, action) {
  return {
    app_key: credentials.app_key,
    app_secret: credentials.app_secret,
    call: action,
    param: [{}]
  };
}
function getAuthQueryParams(credentials) {
  return {};
}
module.exports = { getAuthHeaders, getAuthBody, getAuthQueryParams };