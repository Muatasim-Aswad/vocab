const en = {
  heading: "Sign in to Vocab",
  help: "Enter your personal access token. This browser stays signed in until you sign out.",
  expiredHeading: "Sign in again",
  expiredHelp:
    "Your session is no longer valid. Your search and unsaved draft are kept; sign in to continue.",
  tokenLabel: "Access token",
  signIn: "Sign in",
  signingIn: "Signing in…",
  signOut: "Sign out",
  unreachable: "Vocab could not be reached. Check the connection and try again.",
  checking: "Checking your session…",
  error: {
    invalid: "This token was not accepted. Check it and try again.",
    forbidden: "Sign-in is not allowed from this address.",
    network: "Vocab could not be reached. Check the connection and try again.",
    unexpected: "Sign-in failed unexpectedly. Try again.",
  },
};

const nl: typeof en = {
  heading: "Aanmelden bij Vocab",
  help: "Voer je persoonlijke toegangstoken in. Deze browser blijft aangemeld tot je je afmeldt.",
  expiredHeading: "Opnieuw aanmelden",
  expiredHelp:
    "Je sessie is niet meer geldig. Je zoekopdracht en niet-opgeslagen concept blijven bewaard; meld je aan om verder te gaan.",
  tokenLabel: "Toegangstoken",
  signIn: "Aanmelden",
  signingIn: "Aanmelden…",
  signOut: "Afmelden",
  unreachable: "Vocab is niet bereikbaar. Controleer de verbinding en probeer het opnieuw.",
  checking: "Je sessie wordt gecontroleerd…",
  error: {
    invalid: "Dit token is niet geaccepteerd. Controleer het en probeer het opnieuw.",
    forbidden: "Aanmelden is niet toegestaan vanaf dit adres.",
    network: "Vocab is niet bereikbaar. Controleer de verbinding en probeer het opnieuw.",
    unexpected: "Aanmelden is onverwacht mislukt. Probeer het opnieuw.",
  },
};

export const sessionMessages = { en, nl };
