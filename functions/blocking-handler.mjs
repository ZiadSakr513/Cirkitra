import { EMAIL_DOMAIN_BLOCK_MESSAGE, isAllowedEmailAddress } from "./email-domain-policy.mjs";

export function createEmailDomainBlockingHandler(HttpsError) {
  return (event) => {
    const email = event?.data?.email;
    if (!isAllowedEmailAddress(email)) {
      throw new HttpsError("permission-denied", EMAIL_DOMAIN_BLOCK_MESSAGE);
    }
  };
}
