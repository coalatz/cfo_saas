module.exports = {
  getAuthHeaders: function(credentials) {
    return {
      'Authorization': 'Bearer ' + credentials.access_token,
      'Content-Type': 'application/json'
    };
  },

  getAuthBody: function(credentials, action) {
    return {
      'api_key': credentials.api_key,
      'api_secret': credentials.api_secret,
      'action': action
    };
  },

  getAuthQueryParams: function(credentials) {
    return {
      'access_token': credentials.access_token,
      'api_key': credentials.api_key
    };
  }
};