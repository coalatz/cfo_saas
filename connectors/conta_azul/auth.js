function getAuthHeaders(credentials) {
  return { "Authorization": "Bearer " + credentials.access_token };
}
function getAuthBody(credentials, action) {
  return {};
}
function getAuthQueryParams(credentials) {
  return {};
}
module.exports = { getAuthHeaders, getAuthBody, getAuthQueryParams };