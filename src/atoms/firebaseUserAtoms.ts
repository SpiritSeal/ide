import { atom } from 'jotai';
import type firebaseType from 'firebase';
import animals from '../scripts/animals';
import { signInAnonymously } from '../scripts/firebaseUtils';
import firebase from 'firebase/app';
import { connectionRefAtom } from './firebaseAtoms';
import { shouldUseEmulator } from '../components/WorkspaceInitializer';
import { displayNameAtom } from './userSettings';

const baseFirebaseUserAtom = atom<firebaseType.User | null>(null);
export const firebaseUserAtom = atom(
  get => get(baseFirebaseUserAtom),
  (_get, set, user: firebaseType.User | null) => {
    set(baseFirebaseUserAtom, user);
    if (user) {
      let displayName = user.displayName;
      if (!displayName) {
        displayName =
          'Anonymous ' + animals[Math.floor(animals.length * Math.random())];
        user.updateProfile({ displayName });
      }
      set(displayNameAtom, displayName);
    } else {
      set(displayNameAtom, '');
    }
  }
);
firebaseUserAtom.onMount = setAtom => {
  const unsubscribe = firebase.auth().onAuthStateChanged(user => {
    setAtom(user);
    if (!user) {
      signInAnonymously();
    }
  });

  return () => {
    unsubscribe();
  };
};

export const signInWithGoogleAtom = atom(null, (get, set, _) => {
  const provider = new firebase.auth.GoogleAuthProvider();
  const prevUser = firebase.auth().currentUser;

  // Remove user from user list before signing in
  const prevConnectionRef = get(connectionRefAtom);
  if (prevConnectionRef) set(connectionRefAtom, null);

  const confirmOverrideData = (callback: () => void) => {
    if (
      confirm(
        'Warning: Your local data will be overwritten by your server data. Are you sure you want to proceed?'
      )
    ) {
      callback();
    }
  };

  if (shouldUseEmulator) {
    // Note: for some reason firebase emulator does not work with `linkWithPopup`
    // so we're just going to always sign up with popup instead.
    // To test `linkWithPopup`, go to `src/components/WorkspaceInitializer.tsx`, find `shouldUseEmulator`,
    // and set that to false.
    confirmOverrideData(() => firebase.auth().signInWithPopup(provider));
  } else {
    prevUser
      ?.linkWithPopup(provider)
      .then(result => {
        // linked successfully
        const newName = result.user?.providerData[0]?.displayName;
        if (newName)
          firebase.auth().currentUser!.updateProfile({ displayName: newName });
      })
      .catch(error => {
        if (error.code === 'auth/credential-already-in-use') {
          // user already has an account. Sign in to that account and override our data.
          confirmOverrideData(() => {
            firebase.auth().signInWithCredential(error.credential);
          });
        } else {
          alert('Error signing in: ' + error);
          if (prevConnectionRef) set(connectionRefAtom, prevConnectionRef);
        }
      });
  }
});

export const signOutAtom = atom(null, (_, set) => {
  set(connectionRefAtom, null);
  firebase.auth().signOut();
});
