const express = require("express")
const session = require("express-session")
const SQLiteStore = require("connect-sqlite3")(session)
const bodyParser = require("body-parser")
const bcrypt = require("bcryptjs")
const sqlite3 = require("sqlite3").verbose()
const multer = require("multer")
const path = require("path")
const fs = require("fs")
const storage = multer.memoryStorage()
const upload = multer({ storage })

const app = express()
const PORT = process.env.PORT || 3000

// Ensure database directory exists
const dbDir = "./db"
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir)
}

const db = new sqlite3.Database("./db/imagina.db")

// Database initialization
function initializeDatabase() {
  // Create tables if they don't exist
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
        password TEXT,
        bio TEXT,
        avatar BLOB,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        image BLOB,
        mime_type TEXT,
        title TEXT,
        description TEXT,
        tags TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        image_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, image_id),
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(image_id) REFERENCES images(id)
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS followers (
        user_id INTEGER,
        follower_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, follower_id),
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(follower_id) REFERENCES users(id)
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        image_id INTEGER,
        parent_id INTEGER,
        comment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(image_id) REFERENCES images(id),
        FOREIGN KEY(parent_id) REFERENCES comments(id)
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS comment_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        comment_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, comment_id),
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(comment_id) REFERENCES comments(id)
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS collection_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id INTEGER,
        image_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(collection_id, image_id),
        FOREIGN KEY(collection_id) REFERENCES collections(id),
        FOREIGN KEY(image_id) REFERENCES images(id)
      )
    `)
  })
}

// Initialize database
initializeDatabase()

// Promisify database queries
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err)
      else resolve(row)
    })
  })
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err)
      else resolve({ lastID: this.lastID, changes: this.changes })
    })
  })
}

// Configuration
app.set("view engine", "ejs")
app.set("views", path.join(__dirname, "views"))
app.use(express.static(path.join(__dirname, "public")))
app.use(bodyParser.urlencoded({ extended: true }))
app.use(express.json())

app.use(
  session({
    store: new SQLiteStore({ db: "sessions.db", dir: "db" }),
    secret: "imagina_secret_key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1 * 24 * 60 * 60 * 1000, // 30 days
    },
  }),
)

// Middleware
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login")
  }
  next()
}

// Format date helper
app.locals.formatDate = (dateString) => {
  const date = new Date(dateString)
  return date.toLocaleDateString("es-ES", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

// Rutas
app.get("/", (req, res) => {
  if (req.session.user) {
    res.redirect("/dashboard")
  } else {
    res.redirect("/explorar")
  }
})

// Authentication routes
app.get("/login", (req, res) => {
  if (req.session.user) {
    return res.redirect("/dashboard")
  }
  res.render("auth", { error: null, view: "login" })
})

app.post("/login", async (req, res) => {
  const { username, password } = req.body

  try {
    const user = await dbGet("SELECT * FROM users WHERE username = ?", [username])

    if (!user) {
      return res.render("auth", { error: "Usuario no encontrado.", view: "login" })
    }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return res.render("auth", { error: "Contraseña incorrecta.", view: "login" })
    }

    req.session.user = { id: user.id, username: user.username }
    res.redirect("/dashboard")
  } catch (err) {
    console.error("Error en login:", err)
    res.render("auth", { error: "Error al iniciar sesión.", view: "login" })
  }
})

app.get("/register", (req, res) => {
  if (req.session.user) {
    return res.redirect("/dashboard")
  }
  res.render("auth", { error: null, view: "register" })
})

app.post("/register", async (req, res) => {
  const { username, email, password, confirmPassword } = req.body

  if (password !== confirmPassword) {
    return res.render("auth", { error: "Las contraseñas no coinciden.", view: "register" })
  }

  try {
    const hashed = await bcrypt.hash(password, 10)

    await dbRun("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", [username, email, hashed])

    res.redirect("/login")
  } catch (err) {
    let msg = "Error al registrar."
    if (err.message.includes("UNIQUE constraint failed")) {
      msg = "El usuario o correo ya existe."
    }
    res.render("auth", { error: msg, view: "register" })
  }
})

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login")
  })
})

// Dashboard route
app.get("/dashboard", requireLogin, async (req, res) => {
  try {
    const images = await dbAll("SELECT id, title, created_at FROM images WHERE user_id = ? ORDER BY created_at DESC", [
      req.session.user.id,
    ])

    const stats = await dbGet(
      `
      SELECT 
        (SELECT COUNT(*) FROM images WHERE user_id = ?) as image_count,
        (SELECT COUNT(*) FROM followers WHERE user_id = ?) as follower_count,
        (SELECT COUNT(*) FROM followers WHERE follower_id = ?) as following_count
    `,
      [req.session.user.id, req.session.user.id, req.session.user.id],
    )

    res.render("dashboard", {
      user: req.session.user,
      images,
      stats,
    })
  } catch (err) {
    console.error("Error en dashboard:", err)
    res.render("dashboard", {
      user: req.session.user,
      images: [],
      stats: { image_count: 0, follower_count: 0, following_count: 0 },
    })
  }
})

// Upload routes
app.get("/upload", requireLogin, (req, res) => {
  res.render("upload", { user: req.session.user })
})

app.post("/upload", requireLogin, upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.render("upload", {
      user: req.session.user,
      error: "Debes seleccionar una imagen.",
    })
  }

  const { buffer, mimetype } = req.file
  const { title, description, tags } = req.body
  const userId = req.session.user.id

  try {
    const result = await dbRun(
      "INSERT INTO images (user_id, image, mime_type, title, description, tags) VALUES (?, ?, ?, ?, ?, ?)",
      [userId, buffer, mimetype, title, description, tags],
    )

    res.redirect(`/pin/${result.lastID}`)
  } catch (err) {
    console.error("Error al subir imagen:", err)
    res.render("upload", {
      user: req.session.user,
      error: "Error al subir la imagen.",
    })
  }
})

// Image routes
app.get("/image/:id", async (req, res) => {
  const id = req.params.id

  try {
    const row = await dbGet("SELECT image, mime_type FROM images WHERE id = ?", [id])

    if (!row) {
      return res.status(404).send("Imagen no encontrada")
    }

    res.set("Content-Type", row.mime_type)
    res.send(row.image)
  } catch (err) {
    console.error("Error al obtener imagen:", err)
    res.status(500).send("Error al obtener la imagen")
  }
})

app.get("/pin/:id", async (req, res) => {
  const pinId = req.params.id
  const userId = req.session.user?.id || null

  try {
    // 1) Get pin and author info
    const pin = await dbGet(
      `
      SELECT images.*, users.username
      FROM images
      JOIN users ON images.user_id = users.id
      WHERE images.id = ?
    `,
      [pinId],
    )

    if (!pin) {
      return res.status(404).render("error", {
        message: "Pin no encontrado",
        user: req.session.user,
      })
    }

    // 2) Count image likes
    const likeResult = await dbGet(`SELECT COUNT(*) AS count FROM likes WHERE image_id = ?`, [pinId])
    const likeCount = likeResult?.count || 0

    // 3) Check if current user liked this image
    let liked = false
    if (userId) {
      const likeCheck = await dbGet(`SELECT 1 FROM likes WHERE user_id = ? AND image_id = ?`, [userId, pinId])
      liked = !!likeCheck
    }

    // 4) Get comments
    const comments = await dbAll(
      `
      SELECT c.id, c.user_id, c.parent_id, c.comment, c.created_at, u.username
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.image_id = ?
      ORDER BY c.created_at ASC
    `,
      [pinId],
    )

    // 5) Structure nested comments
    const map = {},
      nested = []
    comments.forEach((c) => (map[c.id] = { ...c, children: [] }))
    comments.forEach((c) => {
      if (c.parent_id) map[c.parent_id]?.children.push(map[c.id])
      else nested.push(map[c.id])
    })

    // 6) Get comment likes
    if (comments.length > 0) {
      const ids = comments.map((c) => c.id)
      const placeholders = ids.map(() => "?").join(",")

      const commentLikeCounts = await dbAll(
        `
        SELECT comment_id, COUNT(*) AS cnt
        FROM comment_likes
        WHERE comment_id IN (${placeholders})
        GROUP BY comment_id
      `,
        ids,
      )

      const cntMap = {}
      commentLikeCounts.forEach((r) => (cntMap[r.comment_id] = r.cnt))

      let likedComments = []
      if (userId) {
        likedComments = await dbAll(
          `
          SELECT comment_id FROM comment_likes
          WHERE user_id = ? AND comment_id IN (${placeholders})
        `,
          [userId, ...ids],
        )
      }

      const likedSet = new Set(likedComments.map((r) => r.comment_id))

      Object.values(map).forEach((c) => {
        c.likeCount = cntMap[c.id] || 0
        c.liked = likedSet.has(c.id)
      })
    }

    // 7) Get user collections for "Save to..." dropdown
    let userCollections = []
    if (userId) {
      userCollections = await dbAll("SELECT * FROM collections WHERE user_id = ?", [userId])
    }

    // 8) Get related pins (same tags)
    const relatedPins = await dbAll(
      `
      SELECT i.id, i.title, i.user_id, u.username
      FROM images i
      JOIN users u ON i.user_id = u.id
      WHERE i.id != ? AND i.tags LIKE ?
      ORDER BY i.created_at DESC
      LIMIT 6
    `,
      [pinId, `%${pin.tags.split(",")[0]}%`],
    )

    res.render("pin", {
      pin,
      userName: pin.username,
      likeCount,
      liked,
      comments: nested,
      currentUserId: userId,
      userCollections,
      relatedPins,
      user: req.session.user,
    })
  } catch (err) {
    console.error("Error al obtener pin:", err)
    res.status(500).render("error", {
      message: "Error al cargar el pin",
      user: req.session.user,
    })
  }
})

// Comment routes
app.post("/comment/:imageId", requireLogin, async (req, res) => {
  const imageId = req.params.imageId
  const userId = req.session.user.id
  const { comment: text, parentId } = req.body

  if (!text?.trim()) {
    return res.status(400).json({ error: "Comentario vacío" })
  }

  try {
    const result = await dbRun(
      `INSERT INTO comments (user_id, image_id, parent_id, comment)
       VALUES (?, ?, ?, ?)`,
      [userId, imageId, parentId || null, text.trim()],
    )

    const newComment = await dbGet(
      `SELECT c.id, c.user_id, c.parent_id, c.comment, c.created_at, u.username
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.id = ?`,
      [result.lastID],
    )

    newComment.likeCount = 0
    newComment.liked = false
    newComment.children = []

    res.json(newComment)
  } catch (err) {
    console.error("Error al crear comentario:", err)
    res.status(500).json({ error: "Error al guardar el comentario" })
  }
})

app.post("/comment/like/:commentId", requireLogin, async (req, res) => {
  const commentId = req.params.commentId
  const userId = req.session.user.id

  try {
    const existingLike = await dbGet(`SELECT 1 FROM comment_likes WHERE user_id = ? AND comment_id = ?`, [
      userId,
      commentId,
    ])

    if (existingLike) {
      // Remove like
      await dbRun(`DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?`, [userId, commentId])
    } else {
      // Add like
      await dbRun(`INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)`, [userId, commentId])
    }

    const likeCount = await dbGet(`SELECT COUNT(*) AS count FROM comment_likes WHERE comment_id = ?`, [commentId])

    res.json({ likeCount: likeCount.count })
  } catch (err) {
    console.error("Error al dar like a comentario:", err)
    res.status(500).json({ error: "Error al procesar el like" })
  }
})

app.post("/comment/delete/:commentId", requireLogin, async (req, res) => {
  const commentId = req.params.commentId
  const userId = req.session.user.id

  try {
    const comment = await dbGet(`SELECT user_id FROM comments WHERE id = ?`, [commentId])

    if (!comment) {
      return res.status(404).json({ error: "Comentario no encontrado" })
    }

    if (comment.user_id !== userId) {
      return res.status(403).json({ error: "No autorizado" })
    }

    // Delete recursively the comment and its replies
    await dbRun(
      `
      WITH RECURSIVE to_delete(id) AS (
        SELECT id FROM comments WHERE id = ?
        UNION ALL
        SELECT c.id FROM comments c
        JOIN to_delete td ON c.parent_id = td.id
      )
      DELETE FROM comments WHERE id IN (SELECT id FROM to_delete);
    `,
      [commentId],
    )

    res.json({ success: true })
  } catch (err) {
    console.error("Error al eliminar comentario:", err)
    res.status(500).json({ error: "Error al eliminar el comentario" })
  }
})

// Like routes
app.post("/like/:imageId", requireLogin, async (req, res) => {
  const imageId = req.params.imageId
  const userId = req.session.user.id

  try {
    const existingLike = await dbGet(`SELECT 1 FROM likes WHERE user_id = ? AND image_id = ?`, [userId, imageId])

    if (existingLike) {
      // Remove like
      await dbRun(`DELETE FROM likes WHERE user_id = ? AND image_id = ?`, [userId, imageId])
    } else {
      // Add like
      await dbRun(`INSERT INTO likes (user_id, image_id) VALUES (?, ?)`, [userId, imageId])
    }

    const likeCount = await dbGet(`SELECT COUNT(*) AS count FROM likes WHERE image_id = ?`, [imageId])

    res.json({ likeCount: likeCount.count })
  } catch (err) {
    console.error("Error al dar like:", err)
    res.status(500).json({ error: "Error al procesar el like" })
  }
})

// User profile routes
app.get("/usuario/:username", async (req, res) => {
  const username = req.params.username
  const currentUserId = req.session.user?.id || null

  try {
    const profileUser = await dbGet(`SELECT id, username, bio, created_at FROM users WHERE username = ?`, [username])

    if (!profileUser) {
      return res.status(404).render("error", {
        message: "Usuario no encontrado",
        user: req.session.user,
      })
    }

    const uid = profileUser.id

    // Get follower count
    const followerResult = await dbGet(`SELECT COUNT(*) AS count FROM followers WHERE user_id = ?`, [uid])
    const followerCount = followerResult?.count || 0

    // Get following count
    const followingResult = await dbGet(`SELECT COUNT(*) AS count FROM followers WHERE follower_id = ?`, [uid])
    const followingCount = followingResult?.count || 0

    // Get total likes on user's images
    const likesResult = await dbGet(
      `SELECT COUNT(*) AS count
       FROM likes l
       JOIN images i ON l.image_id = i.id
       WHERE i.user_id = ?`,
      [uid],
    )
    const totalLikes = likesResult?.count || 0

    // Check if current user follows this profile
    let isFollowing = false
    if (currentUserId && currentUserId !== uid) {
      const followCheck = await dbGet(`SELECT 1 FROM followers WHERE user_id = ? AND follower_id = ?`, [
        uid,
        currentUserId,
      ])
      isFollowing = !!followCheck
    }

    // Get user's images
    const images = await dbAll(
      `SELECT id, title, created_at
       FROM images
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [uid],
    )

    // Get user's collections
    const collections = await dbAll(
      `SELECT id, name, description, 
       (SELECT COUNT(*) FROM collection_images WHERE collection_id = collections.id) AS image_count
       FROM collections
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [uid],
    )

    res.render("profile", {
      profileUser,
      images,
      collections,
      followerCount,
      followingCount,
      totalLikes,
      isFollowing,
      currentUserId,
      user: req.session.user,
    })
  } catch (err) {
    console.error("Error al cargar perfil:", err)
    res.status(500).render("error", {
      message: "Error al cargar el perfil",
      user: req.session.user,
    })
  }
})

app.post("/usuario/:username/follow", requireLogin, async (req, res) => {
  const username = req.params.username
  const currentUserId = req.session.user.id

  try {
    const user = await dbGet(`SELECT id FROM users WHERE username = ?`, [username])

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" })
    }

    if (user.id === currentUserId) {
      return res.status(400).json({ error: "No puedes seguirte a ti mismo" })
    }

    const existingFollow = await dbGet(`SELECT 1 FROM followers WHERE user_id = ? AND follower_id = ?`, [
      user.id,
      currentUserId,
    ])

    if (existingFollow) {
      // Unfollow
      await dbRun(`DELETE FROM followers WHERE user_id = ? AND follower_id = ?`, [user.id, currentUserId])
    } else {
      // Follow
      await dbRun(`INSERT INTO followers (user_id, follower_id) VALUES (?, ?)`, [user.id, currentUserId])
    }

    const followerCount = await dbGet(`SELECT COUNT(*) AS count FROM followers WHERE user_id = ?`, [user.id])

    res.json({
      followerCount: followerCount.count,
      isFollowing: !existingFollow,
    })
  } catch (err) {
    console.error("Error al seguir/dejar de seguir:", err)
    res.status(500).json({ error: "Error al procesar la solicitud" })
  }
})

// Profile edit routes
app.get("/editar-perfil", requireLogin, async (req, res) => {
  try {
    const user = await dbGet("SELECT username, email, bio FROM users WHERE id = ?", [req.session.user.id])

    res.render("editar-perfil", {
      user,
      currentUser: req.session.user,
      error: null,
    })
  } catch (err) {
    console.error("Error al cargar perfil para editar:", err)
    res.render("editar-perfil", {
      user: req.session.user,
      currentUser: req.session.user,
      error: "Error al cargar el perfil",
    })
  }
})

app.post("/editar-perfil", requireLogin, upload.single("avatar"), async (req, res) => {
  const { username, bio } = req.body
  const avatar = req.file?.buffer
  const uid = req.session.user.id

  try {
    // Check if username is already taken by another user
    if (username !== req.session.user.username) {
      const existingUser = await dbGet("SELECT 1 FROM users WHERE username = ? AND id != ?", [username, uid])

      if (existingUser) {
        return res.render("editar-perfil", {
          user: { username: req.session.user.username, bio },
          currentUser: req.session.user,
          error: "El nombre de usuario ya está en uso",
        })
      }
    }

    const sql = avatar
      ? `UPDATE users SET username = ?, bio = ?, avatar = ? WHERE id = ?`
      : `UPDATE users SET username = ?, bio = ? WHERE id = ?`

    const params = avatar ? [username, bio, avatar, uid] : [username, bio, uid]

    await dbRun(sql, params)

    // Update session
    req.session.user.username = username

    res.redirect(`/usuario/${username}`)
  } catch (err) {
    console.error("Error al actualizar perfil:", err)
    res.render("editar-perfil", {
      user: { username, bio },
      currentUser: req.session.user,
      error: "Error al actualizar el perfil",
    })
  }
})

app.get("/avatar/:id", async (req, res) => {
  const uid = req.params.id

  try {
    const row = await dbGet("SELECT avatar FROM users WHERE id = ?", [uid])

    if (!row?.avatar) {
      return res.status(404).send("Avatar no encontrado")
    }

    res.set("Content-Type", "image/png")
    res.send(row.avatar)
  } catch (err) {
    console.error("Error al obtener avatar:", err)
    res.status(500).send("Error al obtener el avatar")
  }
})

// Collection routes
app.get("/colecciones", requireLogin, async (req, res) => {
  try {
    const collections = await dbAll(
      `
      SELECT c.*, 
        (SELECT COUNT(*) FROM collection_images WHERE collection_id = c.id) AS image_count
      FROM collections c
      WHERE c.user_id = ?
      ORDER BY c.created_at DESC
    `,
      [req.session.user.id],
    )

    res.render("colecciones", {
      colecciones: collections,
      user: req.session.user,
    })
  } catch (err) {
    console.error("Error al cargar colecciones:", err)
    res.render("colecciones", {
      colecciones: [],
      user: req.session.user,
    })
  }
})

app.get("/colecciones/nueva", requireLogin, (req, res) => {
  res.render("nueva-coleccion", {
    user: req.session.user,
    error: null,
  })
})

app.post("/colecciones/nueva", requireLogin, async (req, res) => {
  const { name, description } = req.body

  if (!name.trim()) {
    return res.render("nueva-coleccion", {
      user: req.session.user,
      error: "El nombre de la colección es obligatorio",
    })
  }

  try {
    await dbRun("INSERT INTO collections (user_id, name, description) VALUES (?, ?, ?)", [
      req.session.user.id,
      name,
      description,
    ])

    res.redirect("/colecciones")
  } catch (err) {
    console.error("Error al crear colección:", err)
    res.render("nueva-coleccion", {
      user: req.session.user,
      error: "Error al crear la colección",
    })
  }
})

app.get("/coleccion/:id", async (req, res) => {
  const id = req.params.id

  try {
    const collection = await dbGet(
      `
      SELECT c.*, u.username 
      FROM collections c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `,
      [id],
    )

    if (!collection) {
      return res.status(404).render("error", {
        message: "Colección no encontrada",
        user: req.session.user,
      })
    }

    const images = await dbAll(
      `
      SELECT i.id, i.title, i.created_at
      FROM collection_images ci
      JOIN images i ON i.id = ci.image_id
      WHERE ci.collection_id = ?
      ORDER BY ci.created_at DESC
    `,
      [id],
    )

    res.render("ver-coleccion", {
      coleccion: collection,
      images,
      user: req.session.user,
    })
  } catch (err) {
    console.error("Error al cargar colección:", err)
    res.status(500).render("error", {
      message: "Error al cargar la colección",
      user: req.session.user,
    })
  }
})

app.post("/coleccion/agregar", requireLogin, async (req, res) => {
  const userId = req.session.user.id
  const { image_id, collection_id } = req.body

  try {
    // Check if image is already in collection
    const existingEntry = await dbGet("SELECT 1 FROM collection_images WHERE image_id = ? AND collection_id = ?", [
      image_id,
      collection_id,
    ])

    if (existingEntry) {
      return res.redirect(`/pin/${image_id}?mensaje=guardado`)
    }

    // Check if collection belongs to user
    const collection = await dbGet("SELECT 1 FROM collections WHERE id = ? AND user_id = ?", [collection_id, userId])

    if (!collection) {
      return res.status(403).json({ error: "No tienes permiso para modificar esta colección" })
    }

    // Add image to collection
    await dbRun("INSERT INTO collection_images (image_id, collection_id) VALUES (?, ?)", [image_id, collection_id])

    res.redirect(`/pin/${image_id}?mensaje=guardado`)
  } catch (err) {
    console.error("Error al guardar en colección:", err)
    res.status(500).json({ error: "Error al guardar en la colección" })
  }
})

app.post("/coleccion/quitar", requireLogin, async (req, res) => {
  const userId = req.session.user.id
  const { image_id, collection_id } = req.body

  try {
    // Check if collection belongs to user
    const collection = await dbGet("SELECT 1 FROM collections WHERE id = ? AND user_id = ?", [collection_id, userId])

    if (!collection) {
      return res.status(403).json({ error: "No tienes permiso para modificar esta colección" })
    }

    // Remove image from collection
    await dbRun("DELETE FROM collection_images WHERE image_id = ? AND collection_id = ?", [image_id, collection_id])

    res.json({ success: true })
  } catch (err) {
    console.error("Error al quitar de colección:", err)
    res.status(500).json({ error: "Error al quitar de la colección" })
  }
})

// Explore routes
app.get("/explorar", async (req, res) => {
  const page = Number.parseInt(req.query.page) || 1
  const tag = req.query.tag || ""
  const limit = 12
  const offset = (page - 1) * limit

  try {
    let sql = `
      SELECT i.id, i.title, i.user_id, u.username
      FROM images i
      JOIN users u ON i.user_id = u.id
    `

    const params = []

    if (tag) {
      sql += " WHERE LOWER(i.tags) LIKE ?"
      params.push(`%${tag.toLowerCase()}%`)
    }

    sql += " ORDER BY i.created_at DESC LIMIT ? OFFSET ?"
    params.push(limit, offset)

    const images = await dbAll(sql, params)

    // Get popular tags
    const tags = await dbAll(`
      SELECT DISTINCT TRIM(value) as tag, COUNT(*) as count
      FROM images, json_each('["' || REPLACE(REPLACE(tags, ' ', ''), ',', '","') || '"]')
      GROUP BY TRIM(value)
      ORDER BY count DESC
      LIMIT 10
    `)

    res.render("explore", {
      images,
      page,
      tag,
      tags,
      user: req.session.user,
    })
  } catch (err) {
    console.error("Error al cargar explorar:", err)
    res.status(500).render("error", {
      message: "Error al cargar imágenes",
      user: req.session.user,
    })
  }
})

app.get("/api/explorar", async (req, res) => {
  const page = Number.parseInt(req.query.page) || 1
  const tag = req.query.tag || ""
  const limit = 12
  const offset = (page - 1) * limit

  try {
    let sql = `
      SELECT i.id, i.title, i.user_id, u.username
      FROM images i
      JOIN users u ON i.user_id = u.id
    `

    const params = []

    if (tag) {
      sql += " WHERE LOWER(i.tags) LIKE ?"
      params.push(`%${tag.toLowerCase()}%`)
    }

    sql += " ORDER BY i.created_at DESC LIMIT ? OFFSET ?"
    params.push(limit, offset)

    const images = await dbAll(sql, params)

    res.json(images)
  } catch (err) {
    console.error("Error en API explorar:", err)
    res.status(500).json({ error: "Error al cargar imágenes" })
  }
})

// Search route
app.get("/buscar", async (req, res) => {
  const query = req.query.q || ""

  if (!query.trim()) {
    return res.redirect("/explorar")
  }

  try {
    const images = await dbAll(
      `
      SELECT i.id, i.title, i.user_id, u.username
      FROM images i
      JOIN users u ON i.user_id = u.id
      WHERE 
        LOWER(i.title) LIKE ? OR 
        LOWER(i.description) LIKE ? OR 
        LOWER(i.tags) LIKE ?
      ORDER BY i.created_at DESC
      LIMIT 24
    `,
      [`%${query.toLowerCase()}%`, `%${query.toLowerCase()}%`, `%${query.toLowerCase()}%`],
    )

    const users = await dbAll(
      `
      SELECT id, username, bio
      FROM users
      WHERE LOWER(username) LIKE ? OR LOWER(bio) LIKE ?
      LIMIT 10
    `,
      [`%${query.toLowerCase()}%`, `%${query.toLowerCase()}%`],
    )

    res.render("search", {
      query,
      images,
      users,
      user: req.session.user,
    })
  } catch (err) {
    console.error("Error en búsqueda:", err)
    res.status(500).render("error", {
      message: "Error al realizar la búsqueda",
      user: req.session.user,
    })
  }
})

// Error handling
app.use((req, res) => {
  res.status(404).render("error", {
    message: "Página no encontrada",
    user: req.session.user,
  })
})

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).render("error", {
    message: "Error interno del servidor",
    user: req.session.user,
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`)
})
