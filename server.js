const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 } // 24 hours
}));

// Database connection
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'movie_mania'
});

db.connect((err) => {
    if (err) {
        console.error('Database connection failed:', err);
        return;
    }
    console.log('Connected to MySQL database');
});

// Make db available to routes
app.use((req, res, next) => {
    req.db = db;
    next();
});

// ==================== AUTHENTICATION ROUTES ====================

// Check auth status
app.get('/api/auth/check', (req, res) => {
    if (req.session.user) {
        res.json({ logged_in: true, user: req.session.user });
    } else {
        res.json({ logged_in: false });
    }
});

// Login
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    
    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
        if (err || results.length === 0) {
            return res.json({ success: false, error: 'Invalid credentials' });
        }
        
        const user = results[0];
        const isValid = await bcrypt.compare(password, user.password_hash);
        
        if (isValid) {
            req.session.user = {
                id: user.id,
                username: user.username,
                email: user.email,
                is_admin: user.is_admin === 1
            };
            res.json({ success: true, user: req.session.user });
        } else {
            res.json({ success: false, error: 'Invalid credentials' });
        }
    });
});

// Register
app.post('/api/auth/register', (req, res) => {
    const { username, email, password } = req.body;
    
    db.query('SELECT id FROM users WHERE username = ? OR email = ?', [username, email], async (err, results) => {
        if (err) return res.json({ success: false, error: 'Database error' });
        if (results.length > 0) {
            return res.json({ success: false, error: 'Username or email already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.query('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', 
            [username, email, hashedPassword], (err, result) => {
            if (err) return res.json({ success: false, error: 'Registration failed' });
            res.json({ success: true, message: 'Registration successful' });
        });
    });
});

// Logout
app.get('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// ==================== MOVIE ROUTES ====================

// Get all movies
app.get('/api/movies', (req, res) => {
    db.query('SELECT * FROM movies ORDER BY rating DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Get top rated movies
app.get('/api/movies/top', (req, res) => {
    const limit = req.query.limit || 10;
    db.query('SELECT * FROM movies ORDER BY rating DESC LIMIT ?', [parseInt(limit)], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Get movie by ID
app.get('/api/movies/:id', (req, res) => {
    const movieId = req.params.id;
    
    db.query('SELECT * FROM movies WHERE id = ?', [movieId], (err, movie) => {
        if (err) return res.status(500).json({ error: err.message });
        if (movie.length === 0) return res.status(404).json({ error: 'Movie not found' });
        
        // Get reviews for this movie
        db.query(`
            SELECT r.*, u.username 
            FROM reviews r
            JOIN users u ON r.user_id = u.id
            WHERE r.movie_id = ?
            ORDER BY r.created_at DESC
        `, [movieId], (err, reviews) => {
            if (err) return res.status(500).json({ error: err.message });
            movie[0].reviews = reviews;
            res.json(movie[0]);
        });
    });
});

// Get movies by genre
app.get('/api/movies/genre/:genreId', (req, res) => {
    db.query('SELECT * FROM movies WHERE genre_id = ? ORDER BY rating DESC', [req.params.genreId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Search movies
app.get('/api/movies/search/:query', (req, res) => {
    const searchTerm = `%${req.params.query}%`;
    db.query(
        'SELECT * FROM movies WHERE title LIKE ? OR cast LIKE ? OR director LIKE ? ORDER BY rating DESC',
        [searchTerm, searchTerm, searchTerm],
        (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(results);
        }
    );
});

// Add movie (admin only)
app.post('/api/movies', (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const { title, poster_url, rating, release_date, director, cast, description, genre_id, genre_name } = req.body;
    
    db.query(
        'INSERT INTO movies (title, poster_url, rating, release_date, director, cast, description, genre_id, genre_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [title, poster_url, rating, release_date, director, cast, description, genre_id, genre_name],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: result.insertId });
        }
    );
});

// Delete movie (admin only)
app.delete('/api/movies/:id', (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    db.query('DELETE FROM movies WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ==================== REVIEW ROUTES ====================

// Add review
app.post('/api/reviews', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { movie_id, rating, review_text } = req.body;
    const user_id = req.session.user.id;
    
    db.query(
        'INSERT INTO reviews (movie_id, user_id, rating, review_text) VALUES (?, ?, ?, ?)',
        [movie_id, user_id, rating, review_text],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// ==================== WATCHLIST ROUTES ====================

// Get watchlist
app.get('/api/watchlist', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    db.query(`
        SELECT m.* FROM movies m
        JOIN watchlist w ON m.id = w.movie_id
        WHERE w.user_id = ?
    `, [req.session.user.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Add to watchlist
app.post('/api/watchlist', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { movie_id } = req.body;
    const user_id = req.session.user.id;
    
    db.query(
        'INSERT IGNORE INTO watchlist (user_id, movie_id) VALUES (?, ?)',
        [user_id, movie_id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// Remove from watchlist
app.delete('/api/watchlist/:movieId', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    db.query(
        'DELETE FROM watchlist WHERE user_id = ? AND movie_id = ?',
        [req.session.user.id, req.params.movieId],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// ==================== GENRE ROUTES ====================

app.get('/api/genres', (req, res) => {
    db.query(`
        SELECT DISTINCT genre_id as id, genre_name as name, COUNT(*) as movie_count 
        FROM movies 
        GROUP BY genre_id, genre_name 
        ORDER BY genre_id
    `, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});