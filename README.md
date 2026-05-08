# 🚦 AMBOTAKA
**Fitantanana ny Fihaonan'ny Làlana** – Plateforme de signalement de trafic en temps réel pour Madagascar

---

## 🚀 Installation & Lancement

### Prérequis
- Node.js v18+ 
- ngrok (pour l'accès externe)

### Étapes

```bash
# 1. Installer les dépendances
npm install

# 2. Lancer le serveur
node server.js

# 3. Dans un autre terminal, exposer avec ngrok
ngrok http 3000
```

Le serveur démarre sur **http://localhost:3000**

---

## 🔑 Comptes par défaut

| Rôle | Username | Mot de passe |
|------|----------|-------------|
| Admin | `Admin` | `admin1234` |
| Utilisateur demo | `RadoTraffic` | `pass12345` |

---

## 📁 Structure du projet

```
ambotaka/
├── server.js          # Backend Express + WebSocket
├── package.json
└── public/
    ├── index.html     # Interface principale
    ├── style.css      # Styles auth (page login)
    ├── app.css        # Styles application principale
    ├── app.js         # Logique frontend complète
    └── uploads/       # Photos uploadées (auto-créé)
```

---

## ✨ Fonctionnalités

### Carte & Signalement
- 🗺️ Carte Leaflet avec clustering de marqueurs
- 📍 Localisation GPS (signalement uniquement sur position actuelle)
- 🚨 8 types d'incidents: accident, embouteillage, route fermée, travaux, inondation, contrôle, anomalie, autres
- 📸 Photo depuis la caméra du téléphone
- 🎤 Signalement vocal (pré-remplit le formulaire)
- ⏱️ Durée configurable (min 15min), signal disparaît automatiquement
- 🔍 Filtre par type d'incident

### Social & Gamification
- 👍👎 Vote pour/contre (confirmation/infirmation)
- 💬 Chat par incident (mini-chat)
- 🏅 Points et badges (Mpianatra, Mpiambina, Manampahaizana, Champion, Lohahevitra)
- 📉 Perte de points si signalement infirmé par majorité
- 📊 Fiabilité utilisateur (reliability score)

### Temps réel
- ⚡ WebSocket pour mises à jour instantanées
- 🟢 Compteur d'utilisateurs en ligne
- 🔔 Toasts de notification

### Navigation
- 🛣️ Recherche d'itinéraire (Nominatim geocoding + Google Maps)
- 🌡️ Heatmap du trafic (zones les plus signalées)
- 📅 Historique des incidents par date
- ⏰ Partage d'ETA avec lien

### Profil
- 👤 Gestion de profil (avatar, username)
- 🔒 Déconnexion sécurisée
- 🏆 Affichage points, badges, fiabilité

### Admin
- 📊 Statistiques (utilisateurs, incidents, graphique horaire, par route)
- 🏆 Leaderboard communautaire
- 🚫 Gestion des fausses informations (ban/unban, avertissement)
- 📡 Signal prioritaire (visuellement distinct, animé)
- 🗑️ Suppression d'incidents

---

## 🏗️ Architecture technique

- **Backend**: Node.js + Express (REST API)
- **WebSocket**: `ws` library pour le temps réel
- **Storage**: In-memory (données perdues au redémarrage — ajouter une DB pour la production)
- **Auth**: Token UUID stocké en localStorage
- **Upload**: Multer (images jusqu'à 5MB)
- **Frontend**: HTML/CSS/JS vanilla + Leaflet + Chart.js

### Pour la production
Remplacer le stockage in-memory par:
- **MongoDB** ou **PostgreSQL** pour la persistance
- **Redis** pour les sessions WebSocket
- **S3/Cloudinary** pour les images

---

## 🌍 ngrok

```bash
# Après avoir lancé le serveur:
ngrok http 3000

# L'URL ngrok (ex: https://abc123.ngrok.io) peut être partagée
# Le WebSocket fonctionne automatiquement (wss:// en HTTPS)
```
