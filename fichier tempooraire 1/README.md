# Échecs collaboratif — MVP (Node.js + Socket.io)

Jeu par navigateur : deux équipes (Blancs / Noirs), plusieurs joueurs par équipe, **vote collectif** pour chaque coup. Timer **30 s** par tour : le coup avec le plus de votes est joué. **Double vote** : une fois par partie, un joueur peut faire compter son prochain vote pour 2.

- **Pas de base de données** : tout est en mémoire sur le serveur.
- **Règles** : [chess.js](https://github.com/jhlywa/chess.js) côté serveur.

## Structure

```
chess-vote-mvp/
  package.json
  README.md
  server/
    server.js          # Express + HTTP + Socket.io
    socketHandlers.js  # Événements joinGame, voteMove, useDoubleVote…
    gameManager.js     # Rooms, votes, timer, partie
  client/
    index.html
    styles.css
    app.js
```

## Événements Socket.io

| Événement      | Direction | Rôle |
|----------------|-----------|------|
| `joinGame`     | client → serveur | `{ nickname, room, team? }` — `team`: `white`, `black` ou `auto` (équilibre des effectifs) |
| `gameState`    | serveur → client | Plateau, votes, timer, joueurs, permissions |
| `voteMove`     | client → serveur | `{ from, to, promotion? }` |
| `useDoubleVote`| client → serveur | Active le double vote sur le **prochain** vote (1× / partie) |
| `newTurn`      | serveur → client | Nouveau tour de vote |
| `gameOver`     | serveur → client | Fin de partie (échec et mat, nulle, etc.) |
| `joined`       | serveur → client | Confirmation après `joinGame` |
| `requestState` | client → serveur | (optionnel) redemander l’état |
| `chatMessage`  | client → serveur | `{ text }` — message texte (max 500 car.) |
| `chatMessage`  | serveur → tous   | `{ nickname, text, ts }` — diffusion dans la room |

**Vote au plateau :** pendant le tour de ton équipe, tu peux **glisser-déposer** une pièce vers une case : cela envoie le même événement que le bouton « Voter ». À la fin des 30 s,### **🌐 JOUEZ MAINTENANT EN LIGNE**
**URL** : `https://Thermophilus.github.io/chess-collaboratif-app/`

- ✅ **Aucune installation requise**
- ✅ **Fonctionne sur tous les appareils** 
- ✅ **Accès immédiat**
- ✅ **Mises à jour automatiques**

### **📱 PAGE DE TÉLÉCHARGEMENT**
**URL** : `https://Thermophilus.github.io/chess-collaboratif-app/download.html`

- 📥 **Installateurs Windows/macOS/Linux**
- 📱 **QR codes pour mobile**
- 📊 **Statistiques en temps réel**
- 🔄 **Déploiement automatique**

**Liste des coups :** triée du **plus voté au moins voté** ; le ou les coups en tête sont mis en évidence (bordure verte).

**Chat :** panneau à droite ; historique inclus dans `gameState` + messages en temps réel.

## Installation et lancement

Prérequis : **Node.js 18+**.

```bash
cd chess-vote-mvp
npm install
npm start
```

Ouvrir : **http://localhost:3000**

(Le client charge `/socket.io/socket.io.js` depuis ce même serveur — ne pas ouvrir `index.html` en `file://`.)

## Tester à plusieurs

1. Lance `npm start`.
2. Ouvre **plusieurs onglets** (ou navigateurs) sur `http://localhost:3000`.
3. Même **nom de partie**, pseudos différents.
4. Dès qu’il y a **au moins 2 joueurs**, la partie démarre : tour des blancs, puis noirs, etc.
5. Pendant le tour de ton équipe, clique **Voter** sur un coup ; optionnellement **Activer double vote** avant de voter.

## Notes MVP

- S’il n’y a **aucun vote** à la fin du timer, un **coup légal aléatoire** est joué.
- En cas d’**égalité** de votes, un coup parmi les ex-aequo est tiré au **hasard**.
- Si moins de **2 joueurs** restent dans la room, la partie repasse en **lobby** et le plateau est réinitialisé.

Version distincte du prototype **Firebase** à la racine du dossier `chess-collaboratif`.
