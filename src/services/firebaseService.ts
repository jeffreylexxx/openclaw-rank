import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, updateDoc, increment, collection, onSnapshot, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { VersionInfo } from '../types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null, // No auth in this specific simple demo use case
      email: null,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Mandatory connection test
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firestore connection verified.");
  } catch (error) {
    if (error instanceof Error && error.message.includes('unavailable')) {
      console.error("Please check your Firebase configuration or wait for provisioning.");
    }
  }
}
testConnection();

const COLLECTION_NAME = 'openclaw_versions';
const METADATA_DOC = 'ranking_history';

export async function getStoredRankingHistory(): Promise<VersionInfo[]> {
  const path = `metadata/${METADATA_DOC}`;
  try {
    const docRef = doc(db, 'metadata', METADATA_DOC);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data().versions || [];
    }
    return [];
  } catch (e) {
    handleFirestoreError(e, OperationType.GET, path);
    return [];
  }
}

export async function saveRankingHistory(versions: VersionInfo[]) {
  const path = `metadata/${METADATA_DOC}`;
  try {
    const docRef = doc(db, 'metadata', METADATA_DOC);
    await setDoc(docRef, { 
      versions: versions.map(v => ({ version: v.version, rank: v.rank })) ,
      lastUpdated: new Date().toISOString()
    });
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, path);
  }
}

export async function voteForVersion(version: string, type: 'recommend' | 'notRecommend') {
  const path = `${COLLECTION_NAME}/${version}`;
  try {
    const docRef = doc(db, COLLECTION_NAME, version);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      await setDoc(docRef, {
        voteRecommend: type === 'recommend' ? 1 : 0,
        voteNotRecommend: type === 'notRecommend' ? 1 : 0,
      });
    } else {
      await updateDoc(docRef, {
        [type === 'recommend' ? 'voteRecommend' : 'voteNotRecommend']: increment(1)
      });
    }
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, path);
  }
}

export function subscribeToVotes(callback: (votes: Record<string, { recommend: number, notRecommend: number }>) => void) {
  const q = collection(db, COLLECTION_NAME);
  return onSnapshot(q, (snapshot) => {
    const votes: Record<string, { recommend: number, notRecommend: number }> = {};
    snapshot.forEach(doc => {
      votes[doc.id] = {
        recommend: doc.data().voteRecommend || 0,
        notRecommend: doc.data().voteNotRecommend || 0,
      };
    });
    callback(votes);
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, COLLECTION_NAME);
  });
}
