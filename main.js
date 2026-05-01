import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";
import { getFirestore, collection, addDoc, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAiv4xuYxsYd9OX6PXz1cWokGeHwc9_esw",
  authDomain: "alerts-site.firebaseapp.com",
  projectId: "alerts-site",
  storageBucket: "alerts-site.firebasestorage.app",
  messagingSenderId: "594437817901",
  appId: "1:594437817901:web:91f54ea615aa71df791aa4",
  measurementId: "G-0S56TF63Q0"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const messaging = getMessaging(app);

export async function initNotifications() {
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const currentToken = await getToken(messaging, { 
        vapidKey: 'BKnRyRtq47RP6OakmLzS5FWhAcl4Fngo3JuQ_Mzq-isFQoQ6VoDqdzwjIcSjzpNOuwHBQAG5mqIYcyhGmXDV31Y' 
      });

      if (currentToken) {
        const q = query(collection(db, "tokens"), where("token", "==", currentToken));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          await addDoc(collection(db, "tokens"), {
            token: currentToken,
            createdAt: new Date()
          });
          alert("נרשמת בהצלחה!");
        } else {
          console.log("Token already exists.");
        }
      }
    }
  } catch (error) {
    console.error("FCM Error:", error);
  }
}
