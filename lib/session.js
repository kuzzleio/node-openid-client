class Session {
  async get(key) {}
  async set(key, value) {}
  async delete(key) {}
}

class SessionWrapper extends Session {
  constructor (session) {
    super();
    this.session = session;
  }

  async get(key) {
    return this.session[key];
  }

  async set(key, value) {
    this.session[key] = value;
  }

  async delete(key) {
    delete this.session[key];
  }
}

function wrap(session) {
  if (session instanceof Session) {
    return session;
  }
  return new SessionWrapper(session);
}

module.exports = {
  Session,
  wrap
};