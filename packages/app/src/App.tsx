import React from 'react';
import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import { navModule } from './modules/nav';
import { homeModule } from './modules/home';
import { oidcAuthApiRef } from '@backstage/core-plugin-api';
import { SignInPage } from '@backstage/core-components';

export default createApp({
  features: [catalogPlugin, navModule, homeModule],
  components: {
    SignInPage: props => (
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
});
