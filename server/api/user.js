/**
 * api/user.js
 * API de gestion utilisateur
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 */

/*
import { Router } from 'express';

const router = Router();

/**
 * Middleware pour identifier l'utilisateur
 * Utilise le header X-Device-ID ou crée un nouvel utilisateur
 */
/*
router.use(async (req, res, next) => {
  try {
    const { userMemory } = req.app.locals;
    const deviceId = req.headers['x-device-id'];

    if (!deviceId) {
      return res.status(401).json({
        error: 'X-Device-ID header requis',
      });
    }

    const user = await userMemory.getOrCreateUser(deviceId);
    req.userId = user.id;
    req.user = user;
    
    next();
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/user
 * Profil utilisateur
 */
/*
router.get('/', async (req, res) => {
  res.json({
    id: req.user.id,
    createdAt: req.user.createdAt,
    lastSeenAt: req.user.lastSeenAt,
    preferences: req.user.preferences,
  });
});

// === FAVORIS ===

/**
 * GET /api/user/favorites
 * Liste des favoris
 */
/*
router.get('/favorites', async (req, res, next) => {
  try {
    const { userMemory } = req.app.locals;
    const favorites = await userMemory.getFavorites(req.userId);

    res.json({
      favorites,
      count: favorites.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/user/favorites
 * Ajouter un favori
 * 
 * Body:
 * {
 *   place: { id, type, name, lat, lon },
 *   name?: string,
 *   type?: 'home' | 'work' | 'other'
 * }
 */
/*
router.post('/favorites', async (req, res, next) => {
  try {
    const { userMemory } = req.app.locals;
    const { place, name, type } = req.body;

    if (!place || !place.id) {
      return res.status(400).json({
        error: 'place avec id requis',
      });
    }

    // Cas spéciaux: domicile et travail
    if (type === 'home' || type === 'work') {
      const favorite = await userMemory.setHomeOrWork(req.userId, place, type);
      return res.json({ favorite });
    }

    const favorite = await userMemory.addFavorite(req.userId, place, { name, type });
    res.json({ favorite });

  } catch (error) {
    if (error.message.includes('Limite')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * DELETE /api/user/favorites/:id
 * Supprimer un favori
 */
/*
router.delete('/favorites/:id', async (req, res, next) => {
  try {
    const { userMemory } = req.app.locals;
    await userMemory.removeFavorite(req.userId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    if (error.message.includes('non trouvé')) {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
});

// === HISTORIQUE ===

/**
 * GET /api/user/history
 * Historique de recherche
 */
/*
router.get('/history', async (req, res, next) => {
  try {
    const { userMemory } = req.app.locals;
    const { limit = 20 } = req.query;

    const history = await userMemory.getRecentSearches(req.userId, parseInt(limit));

    res.json({
      history,
      count: history.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/user/history
 * Effacer l'historique
 */
/*
router.delete('/history', async (req, res, next) => {
  try {
    const { userMemory } = req.app.locals;
    await userMemory.clearHistory(req.userId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// === PRÉFÉRENCES ===

/**
 * GET /api/user/preferences
 * Préférences utilisateur
 */
/*
router.get('/preferences', async (req, res, next) => {
  try {
    const { userMemory } = req.app.locals;
    const preferences = await userMemory.getPreferences(req.userId);
    res.json({ preferences });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/user/preferences
 * Modifier les préférences
 */
/*
router.patch('/preferences', async (req, res, next) => {
  try {
    const { userMemory } = req.app.locals;
    const preferences = await userMemory.updatePreferences(req.userId, req.body);
    res.json({ preferences });
  } catch (error) {
    next(error);
  }
});

// === STATISTIQUES ===

/**
 * GET /api/user/stats
 * Statistiques utilisateur (arrêts fréquents, etc.)
 */
/*
router.get('/stats', async (req, res, next) => {
  try {
    const { userMemory } = req.app.locals;
    const frequentStops = await userMemory.getFrequentStops(req.userId, 10);

    res.json({
      frequentStops,
    });
  } catch (error) {
    next(error);
  }
});

// === RGPD ===

/**
 * GET /api/user/export
 * Exporter toutes les données utilisateur (RGPD)
 */
/*
router.get('/export', async (req, res, next) => {
  try {
    const { userMemory } = req.app.locals;
    const data = await userMemory.exportUserData(req.userId);

    res.setHeader('Content-Disposition', 'attachment; filename=peribus-data.json');
    res.json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/user
 * Supprimer le compte (RGPD - droit à l'oubli)
 */
/*
router.delete('/', async (req, res, next) => {
  try {
    const { userMemory } = req.app.locals;
    await userMemory.deleteUserData(req.userId);
    res.json({ success: true, message: 'Compte supprimé' });
  } catch (error) {
    next(error);
  }
});

export default router;
*/

// Placeholder
const router = {};
export default router;
