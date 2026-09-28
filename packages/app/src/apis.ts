import {
  createApiRef,
  OAuthApi,
  OpenIdConnectApi,
  ProfileInfoApi,
  BackstageIdentityApi,
  SessionApi,
  createApiFactory,
  discoveryApiRef,
  oauthRequestApiRef,
  configApiRef,
  ApiBlueprint,
} from '@backstage/frontend-plugin-api';
import { OAuth2 } from '@backstage/core-app-api';

export const oidcAuthApiRef = createApiRef<
  OAuthApi & OpenIdConnectApi & ProfileInfoApi & BackstageIdentityApi & SessionApi
>({
  id: 'auth.oidc',
});

export const oidcApiExtension = ApiBlueprint.make({
  params: defineParams =>
    defineParams(
      createApiFactory({
        api: oidcAuthApiRef,
        deps: {
          discoveryApi: discoveryApiRef,
          oauthRequestApi: oauthRequestApiRef,
          configApi: configApiRef,
        },
        factory: ({ discoveryApi, oauthRequestApi, configApi }) =>
          OAuth2.create({
            configApi,
            discoveryApi,
            oauthRequestApi,
            provider: {
              id: 'oidc',
              title: 'Keycloak SSO',
              icon: () => null,
            },
            environment: configApi.getOptionalString('auth.environment'),
            defaultScopes: ['openid', 'email', 'profile'],
          }),
      }),
    ),
});
