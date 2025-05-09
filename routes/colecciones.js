// Si no lo tienes aún, asegúrate de requerir tu base de datos y Express
const express = require('express');
const router = express.Router();
const db = require('../db/imagina.db'); // Ajusta según tu estructura

// Middleware para proteger ruta
function ensureLoggedIn(req, res, next) {
  if (req.session.userId) return next();
  return res.status(401).send("Debes iniciar sesión");
}

router.post('/coleccion/agregar', ensureLoggedIn, (req, res) => {
  const { image_id, collection_id } = req.body;
  const user_id = req.session.userId;

  const query = `INSERT INTO colecciones_imagenes (collection_id, image_id, user_id) VALUES (?, ?, ?)`;

  db.run(query, [collection_id, image_id, user_id], function(err) {
    if (err) {
      console.error("Error al guardar imagen en colección:", err);
      return res.status(500).send("Error al guardar");
    }
    res.redirect("back");
  });
});

module.exports = router;
