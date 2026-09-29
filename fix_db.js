import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, deleteDoc, doc } from "firebase/firestore";
import fetch from "node-fetch";

// Use the firebase config from the project, but we don't have the client sdk setup for node easily.
// Actually, we can use the admin sdk, or just write a small react component to do it.
