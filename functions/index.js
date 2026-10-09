import {
  beforeUserCreated,
  beforeUserSignedIn,
  HttpsError,
} from "firebase-functions/v2/identity";

import { createEmailDomainBlockingHandler } from "./blocking-handler.mjs";

const enforceAllowedEmailDomain = createEmailDomainBlockingHandler(HttpsError);

export const beforeCreate = beforeUserCreated(enforceAllowedEmailDomain);
export const beforeSignIn = beforeUserSignedIn(enforceAllowedEmailDomain);
