const http = require('http');

const sinon = require('sinon');
const MockRequest = require('readable-mock-req');
const { expect } = require('chai');

const { Issuer, Strategy } = require('../../lib');

describe('OpenIDConnectStrategy', () => {
  before(function () {
    this.origIncomingMessage = http.IncomingMessage;
    http.IncomingMessage = MockRequest;
  });

  after(function () {
    http.IncomingMessage = this.origIncomingMessage;
  });

  beforeEach(function () {
    this.issuer = new Issuer({
      issuer: 'https://op.example.com',
      authorization_endpoint: 'https://op.example.com/auth',
      jwks_uri: 'https://op.example.com/jwks',
      token_endpoint: 'https://op.example.com/token',
      userinfo_endpoint: 'https://op.example.com/userinfo',
      code_challenge_methods_supported: ['plain', 'S256'],
    });

    this.client = new this.issuer.Client({
      client_id: 'foo',
      client_secret: 'barbaz',
      respose_types: ['code'],
      redirect_uris: ['http://rp.example.com/cb'],
    });
  });

  it('checks that client is a Client instance', () => {
    expect(() => Strategy({ client: 'foo' })).to.throw(
      'client must be an instance of openid-client Client',
    );
  });

  it('checks that verify callback is a function', function () {
    expect(() => Strategy({ client: this.client })).to.throw('verify callback must be a function');
  });

  it('checks that issuer has an issuer identifier', () => {
    const issuer = new Issuer({});
    const client = new issuer.Client({ client_id: 'identifier' });

    expect(() => Strategy({ client }, () => {})).to.throw(
      'client must have an issuer with an identifier',
    );
  });

  it('checks for session presence', async function (next) {
    const strategy = new Strategy({ client: this.client }, () => {});

    const req = new MockRequest('GET', '/login/oidc');

    strategy.error = (error) => {
      try {
        expect(error).to.be.an.instanceof(Error);
        expect(error.message).to.match(/session/);
        next();
      } catch (err) {
        next(err);
      }
    };
    await strategy.authenticate(req);
  });

  describe('authenticate', function () {
    it('forwards options.extras to callback as extras param', async function () {
      const extras = {
        clientAssertionPayload: {
          aud: 'https://oidc.corp.com/default-oidc-provider',
        },
      };

      const params = {
        redirect_uri: 'http://domain.inc/oauth2/callback',
      };

      const strategy = new Strategy({ client: this.client, params, extras }, () => {});
      const req = new MockRequest('GET', '/login/oidc');
      req.session = { 'oidc:op.example.com': sinon.match.object };

      /* Fake callback params */
      const callbackParams = { code: 'some-code' };
      sinon.stub(this.client, 'callbackParams').callsFake(() => callbackParams);

      this.client.callback = sinon.spy();

      await strategy.authenticate(req, {});
      sinon.assert.calledOnce(this.client.callback);
      sinon.assert.calledWith(
        this.client.callback,
        params.redirect_uri,
        callbackParams,
        sinon.match.object,
        extras,
      );
    });
  });

  describe('initiate', function () {
    it('starts authentication requests for GETs', async function () {
      const params = { foo: 'bar' };
      const strategy = new Strategy({ client: this.client, params }, () => {});

      const req = new MockRequest('GET', '/login/oidc');
      req.session = {};

      strategy.redirect = sinon.spy();
      await strategy.authenticate(req);

      expect(params).to.eql({ foo: 'bar' });
      expect(strategy.redirect.calledOnce).to.be.true;
      const target = strategy.redirect.firstCall.args[0];
      expect(target).to.include('redirect_uri=');
      expect(target).to.include('scope=');
      expect(req.session).to.have.property('oidc:op.example.com');
      expect(req.session['oidc:op.example.com']).to.have.keys(
        'state',
        'response_type',
        'code_verifier',
      );
    });

    it('starts authentication requests for TPIL GETs', async function () {
      const params = { iss: 'https://op.example.com' };
      const strategy = new Strategy({ client: this.client, params }, () => {});

      const req = new MockRequest('GET', '/login/oidc');
      req.session = {};

      strategy.redirect = sinon.spy();
      await strategy.authenticate(req);

      expect(strategy.redirect.calledOnce).to.be.true;
      const target = strategy.redirect.firstCall.args[0];
      expect(target).to.include('redirect_uri=');
      expect(target).to.include('scope=');
      expect(req.session).to.have.property('oidc:op.example.com');
      expect(req.session['oidc:op.example.com']).to.have.keys(
        'state',
        'response_type',
        'code_verifier',
      );
    });

    it('starts authentication requests for POSTs', async function () {
      const strategy = new Strategy({ client: this.client }, () => {});

      const req = new MockRequest('POST', '/login/oidc');
      req.session = {};
      req.body = {};

      strategy.redirect = sinon.spy();
      await strategy.authenticate(req);

      expect(strategy.redirect.calledOnce).to.be.true;
      const target = strategy.redirect.firstCall.args[0];
      expect(target).to.include('redirect_uri=');
      expect(target).to.include('scope=');
      expect(req.session).to.have.property('oidc:op.example.com');
      expect(req.session['oidc:op.example.com']).to.have.keys(
        'state',
        'response_type',
        'code_verifier',
      );
    });

    it('can have redirect_uri and scope specified', async function () {
      const strategy = new Strategy(
        {
          client: this.client,
          params: {
            redirect_uri: 'https://example.com/cb',
            scope: 'openid profile',
          },
        },
        () => {},
      );

      const req = new MockRequest('GET', '/login/oidc');
      req.session = {};

      strategy.redirect = sinon.spy();
      await strategy.authenticate(req);

      expect(strategy.redirect.calledOnce).to.be.true;
      const target = strategy.redirect.firstCall.args[0];
      expect(target).to.include(`redirect_uri=${encodeURIComponent('https://example.com/cb')}`);
      expect(target).to.include('scope=openid%20profile');
    });

    it('can have authorization parameters specified at runtime', async function () {
      const strategy = new Strategy(
        {
          client: this.client,
          params: {
            redirect_uri: 'https://example.com/cb',
            scope: 'openid profile',
          },
        },
        () => {},
      );

      const req = new MockRequest('GET', '/login/oidc');
      req.session = {};

      strategy.redirect = sinon.spy();
      await strategy.authenticate(req, { resource: 'urn:example:foo' });

      expect(strategy.redirect.calledOnce).to.be.true;
      const target = strategy.redirect.firstCall.args[0];
      expect(target).to.include(`resource=${encodeURIComponent('urn:example:foo')}`);
    });

    it('automatically includes nonce for where it applies (and ignores one from params)', async function () {
      const strategy = new Strategy(
        {
          client: this.client,
          params: {
            response_type: 'code id_token token',
            response_mode: 'form_post',
            nonce: 'foo',
          },
        },
        () => {},
      );

      const req = new MockRequest('GET', '/login/oidc');
      req.session = {};

      strategy.redirect = sinon.spy();
      await strategy.authenticate(req);

      expect(strategy.redirect.calledOnce).to.be.true;
      const target = strategy.redirect.firstCall.args[0];
      expect(target).to.include('redirect_uri=');
      expect(target).to.include('scope=');
      expect(target).to.include('nonce=');
      expect(target).not.to.include('nonce=foo');
      expect(target).to.include('response_mode=form_post');
      expect(req.session).to.have.property('oidc:op.example.com');
      expect(req.session['oidc:op.example.com']).to.have.keys(
        'state',
        'nonce',
        'response_type',
        'code_verifier',
      );
    });

    it('ignores static state coming from params', async function () {
      const strategy = new Strategy(
        {
          client: this.client,
          params: {
            state: 'foo',
          },
        },
        () => {},
      );

      const req = new MockRequest('GET', '/login/oidc');
      req.session = {};

      strategy.redirect = sinon.spy();
      await strategy.authenticate(req);

      expect(strategy.redirect.calledOnce).to.be.true;
      const target = strategy.redirect.firstCall.args[0];
      expect(target).to.include('redirect_uri=');
      expect(target).to.include('scope=');
      expect(target).to.include('state=');
      expect(target).not.to.include('state=foo');
      expect(req.session).to.have.property('oidc:op.example.com');
      expect(req.session['oidc:op.example.com']).to.have.keys(
        'state',
        'response_type',
        'code_verifier',
      );
    });

    describe('use pkce', () => {
      it('will throw when explictly provided value is not supported', function () {
        expect(() => {
          new Strategy(
            {
              client: this.client,
              usePKCE: 'foobar',
            },
            () => {},
          );
        }).to.throw('foobar is not valid/implemented PKCE code_challenge_method');
      });

      it('can be set to use PKCE (S256)', async function () {
        const strategy = new Strategy(
          {
            client: this.client,
            usePKCE: 'S256',
          },
          () => {},
        );

        const req = new MockRequest('GET', '/login/oidc');
        req.session = {};

        strategy.redirect = sinon.spy();
        await strategy.authenticate(req);

        expect(strategy.redirect.calledOnce).to.be.true;
        const target = strategy.redirect.firstCall.args[0];
        expect(target).to.include('code_challenge_method=S256');
        expect(target).to.include('code_challenge=');
        expect(req.session).to.have.property('oidc:op.example.com');
        expect(req.session['oidc:op.example.com']).to.have.property('code_verifier');
      });

      it('can be set to use PKCE (plain)', async function () {
        const strategy = new Strategy(
          {
            client: this.client,
            usePKCE: 'plain',
          },
          () => {},
        );

        const req = new MockRequest('GET', '/login/oidc');
        req.session = {};

        strategy.redirect = sinon.spy();
        await strategy.authenticate(req);

        expect(strategy.redirect.calledOnce).to.be.true;
        const target = strategy.redirect.firstCall.args[0];
        expect(target).not.to.include('code_challenge_method');
        expect(target).to.include('code_challenge=');
        expect(req.session).to.have.property('oidc:op.example.com');
        expect(req.session['oidc:op.example.com']).to.have.property('code_verifier');
      });
    });

    it('can have session key specifed', async function () {
      const strategy = new Strategy(
        {
          client: this.client,
          sessionKey: 'oidc:op.example.com:foo',
        },
        () => {},
      );

      const req = new MockRequest('GET', '/login/oidc');
      req.session = {};

      strategy.redirect = sinon.spy();
      await strategy.authenticate(req);

      expect(req.session).to.have.property('oidc:op.example.com:foo');
      expect(req.session['oidc:op.example.com:foo']).to.have.keys(
        'state',
        'response_type',
        'code_verifier',
      );
    });
  });

  describe('callback', async function () {
    it('triggers the verify function and then the success one', async function () {
      const ts = { foo: 'bar' };
      sinon.stub(this.client, 'callback').callsFake(async () => ts);

      const strategy = new Strategy({ client: this.client }, (tokenset, done) => {
        expect(tokenset).to.equal(ts);
        done(null, tokenset);
      });

      let resolve;
      const promise = new Promise(res => { resolve = res; });

      strategy.success = () => {
        resolve();
      };

      const req = new MockRequest('GET', '/login/oidc/callback?code=foobar&state=state');
      req.session = {
        'oidc:op.example.com': {
          nonce: 'nonce',
          state: 'state',
          response_type: 'code',
        },
      };

      await strategy.authenticate(req);
      
      return promise;
    });

    it('triggers the error function when server_error is encountered', async function () {
      const strategy = new Strategy({ client: this.client }, () => {});

      const req = new MockRequest('GET', '/login/oidc/callback?error=server_error&state=state');
      req.session = {
        'oidc:op.example.com': {
          nonce: 'nonce',
          state: 'state',
          response_type: 'code',
        },
      };

      let resolve, reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });

      strategy.error = (error) => {
        try {
          expect(error.error).to.equal('server_error');
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      await strategy.authenticate(req);
      return promise;
    });

    it('lets the dev know when most common problems with session occur', async function () {
      const strategy = new Strategy({ client: this.client }, () => {});

      const req = new MockRequest('GET', '/login/oidc/callback?code=code&state=foo');
      req.session = {};

      let resolve, reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });

      strategy.error = (error) => {
        try {
          expect(error.message).to.eql(
            'did not find expected authorization request details in session, req.session["oidc:op.example.com"] is undefined',
          );
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      await strategy.authenticate(req);
      return promise;
    });

    it('triggers the error function when non oidc error is encountered', async function () {
      const strategy = new Strategy({ client: this.client }, () => {});

      sinon.stub(this.client, 'callback').callsFake(async () => {
        throw new Error('callback error');
      });

      const req = new MockRequest('GET', '/login/oidc/callback?code=code&state=state');
      req.session = {
        'oidc:op.example.com': {
          nonce: 'nonce',
          state: 'state',
          response_type: 'code',
        },
      };

      let resolve, reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });

      strategy.error = (error) => {
        try {
          expect(error.message).to.equal('callback error');
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      await strategy.authenticate(req);
      return promise;
    });

    it('triggers the fail function when oidc error is encountered', async function () {
      const strategy = new Strategy({ client: this.client }, () => {});

      const req = new MockRequest('GET', '/login/oidc/callback?error=login_required&state=state');
      req.session = {
        'oidc:op.example.com': {
          nonce: 'nonce',
          state: 'state',
          response_type: 'code',
        },
      };

      let resolve, reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });

      strategy.fail = (error) => {
        try {
          expect(error.error).to.equal('login_required');
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      await strategy.authenticate(req);
      return promise;
    });

    it('triggers the error function for errors during verify', async function () {
      const strategy = new Strategy({ client: this.client }, (tokenset, done) => {
        done(new Error('user find error'));
      });

      const ts = { foo: 'bar' };
      sinon.stub(this.client, 'callback').callsFake(async () => ts);

      const req = new MockRequest('GET', '/login/oidc/callback?code=foo&state=state');
      req.session = {
        'oidc:op.example.com': {
          nonce: 'nonce',
          state: 'state',
          response_type: 'code',
        },
      };

      let resolve, reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });

      strategy.error = (error) => {
        try {
          expect(error.message).to.equal('user find error');
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      await strategy.authenticate(req);
      return promise;
    });

    it('triggers the fail function when verify yields no account', async function () {
      const strategy = new Strategy({ client: this.client }, (tokenset, done) => {
        done();
      });

      const ts = { foo: 'bar' };
      sinon.stub(this.client, 'callback').callsFake(async () => ts);

      const req = new MockRequest('GET', '/login/oidc/callback?code=foo&state=state');
      req.session = {
        'oidc:op.example.com': {
          nonce: 'nonce',
          response_type: 'code',
          state: 'state',
        },
      };

      let resolve;
      const promise = new Promise((res, rej) => {
        resolve = res;
      });

      strategy.fail = () => {
        resolve();
      };

      await strategy.authenticate(req);
      return promise;
    });

    it('does userinfo request too if part of verify arity and resulting tokenset', async function () {
      let resolve, reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });

      const strategy = new Strategy({ client: this.client }, (tokenset, userinfo, done) => {
        try {
          expect(tokenset).to.be.ok;
          expect(userinfo).to.be.ok;
          done(null, { sub: 'foobar' });
        } catch (err) {
          reject(err);
        }
      });

      const ts = { access_token: 'foo' };
      const ui = { sub: 'bar' };
      sinon.stub(this.client, 'callback').callsFake(async () => ts);
      sinon.stub(this.client, 'userinfo').callsFake(async () => ui);

      const req = new MockRequest('GET', '/login/oidc/callback?code=foo&state=state');
      req.session = {
        'oidc:op.example.com': {
          nonce: 'nonce',
          response_type: 'code',
          state: 'state',
        },
      };

      strategy.success = () => {
        resolve();
      };

      await strategy.authenticate(req);
      return promise;
    });

    it('throws when userinfo is requested but no access_token was returned', async function () {
      const strategy = new Strategy({ client: this.client }, (tokenset, userinfo, done) => {});

      const ts = { id_token: 'foo' };
      sinon.stub(this.client, 'callback').callsFake(async () => ts);

      const req = new MockRequest('GET', '/login/oidc/callback?code=foo&state=state');
      req.session = {
        'oidc:op.example.com': {
          nonce: 'nonce',
          response_type: 'code',
          state: 'state',
        },
      };

      let resolve, reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });

      strategy.fail = (err) => {
        try {
          expect(err.name).to.equal('RPError');
          expect(err.message).to.equal(
            'expected access_token to be returned when asking for userinfo in verify callback',
          );
          expect(err).to.have.property('tokenset');
          resolve();
        } catch (e) {
          reject(e);
        }
      };

      await strategy.authenticate(req);
      return promise;
    });

    it('receives a request as the first parameter if passReqToCallback is set', async function () {
      let resolve, reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });

      const strategy = new Strategy(
        {
          client: this.client,
          passReqToCallback: true,
        },
        (req, tokenset, done) => {
          try {
            expect(req).to.be.an.instanceof(MockRequest);
            expect(tokenset).to.be.ok;
            done(null, { sub: 'foobar' });
          } catch (err) {
            reject(err);
          }
        },
      );

      const ts = { id_token: 'foo' };
      sinon.stub(this.client, 'callback').callsFake(async () => ts);

      const req = new MockRequest('GET', '/login/oidc/callback?code=foo&state=state');
      req.session = {
        'oidc:op.example.com': {
          nonce: 'nonce',
          response_type: 'code',
          state: 'state',
        },
      };

      strategy.success = () => {
        resolve();
      };

      await strategy.authenticate(req);
      return promise;
    });

    it('receives a request and userinfo with passReqToCallback: true and userinfo', async function () {
      let resolve, reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });

      const strategy = new Strategy(
        {
          client: this.client,
          passReqToCallback: true,
        },
        (req, tokenset, userinfo, done) => {
          try {
            expect(req).to.be.an.instanceof(MockRequest);
            expect(tokenset).to.be.ok;
            expect(userinfo).to.be.ok;
            done(null, { sub: 'foobar' });
          } catch (err) {
            reject(err);
          }
        },
      );

      const ts = { access_token: 'foo' };
      const ui = { sub: 'bar' };
      sinon.stub(this.client, 'callback').callsFake(async () => ts);
      sinon.stub(this.client, 'userinfo').callsFake(async () => ui);

      const req = new MockRequest('GET', '/login/oidc/callback?code=foo&state=state');
      req.session = {
        'oidc:op.example.com': {
          nonce: 'nonce',
          response_type: 'code',
          state: 'state',
        },
      };

      strategy.success = () => {
        resolve();
      };

      await strategy.authenticate(req);
      return promise;
    });
  });
});
