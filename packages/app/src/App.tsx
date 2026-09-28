import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import { navModule } from './modules/nav';
import { homeModule } from './modules/home';
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { SignInPageBlueprint } from '@backstage/plugin-app-react';
import { SignInPage } from '@backstage/core-components';
import { oidcAuthApiRef, oidcApiExtension } from './apis';

const authModule = createFrontendModule({
  pluginId: 'app',
  extensions: [
    oidcApiExtension,
    SignInPageBlueprint.make({
      params: {
        loader: async () => props => (
          <SignInPage
            {...props}
            auto
            provider={{
              id: 'oidc',
              title: 'Keycloak SSO',
              message: 'Sign in using Keycloak',
              apiRef: oidcAuthApiRef,
            }}
          />
        ),
      },
    }),
  ],
});

export default createApp({
  features: [catalogPlugin, navModule, homeModule, authModule],
});
