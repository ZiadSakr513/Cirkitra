# Firebase email-domain blocking

The Functions v2 entry point exports Firebase Authentication `beforeUserCreated` and `beforeUserSignedIn` blocking triggers. Firebase deploys these as second-generation Cloud Functions backed by Cloud Run. Both use the single allowlist in `email-domain-policy.json`, which Cirkitra also imports for its client and server checks.

## Rollout

1. Enable Firebase Authentication with Identity Platform for the Firebase project. Blocking functions are unavailable until the project is upgraded.
2. Deploy these functions before deploying the Cirkitra app changes:

   ```powershell
   firebase deploy --only functions --project YOUR_FIREBASE_PROJECT_ID
   ```

3. In Firebase Console → Authentication → Settings → Blocking functions, verify that both **before user created** and **before user signed in** point to the deployed functions. Do not deploy the app checks to production until both triggers are active; otherwise the server-side checks still deny unsupported domains, but signup errors may be less helpful.
4. In a disposable Identity Platform project, verify that unsupported email/password and Google accounts are rejected and that each allowed provider can still register and sign in. These triggers apply to every interactive Firebase Authentication user in the project.
5. Deploy the Cirkitra app changes after the blocking-trigger tests pass.

If a blocking function is removed later, unregister its Authentication trigger as well; a stale trigger can prevent sign-in for the whole Firebase project.
