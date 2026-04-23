from flask import Flask, jsonify
from flask_cors import CORS
from backend.config import config
from backend.db.seed_data import seed_if_empty
from backend.services.simulation_engine import start_background_simulation
from backend.routes.dashboard_routes import dashboard_bp
from backend.routes.flight_routes import flight_bp
from backend.routes.delay_routes import delay_bp
from backend.routes.recommendation_routes import recommendation_bp
from backend.routes.report_routes import report_bp
from backend.routes.logs_routes import logs_bp


def create_app():
    app = Flask(__name__)
    CORS(app)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(flight_bp)
    app.register_blueprint(delay_bp)
    app.register_blueprint(recommendation_bp)
    app.register_blueprint(report_bp)
    app.register_blueprint(logs_bp)

    @app.get("/api/health")
    def health():
        return jsonify(
            {
                "status": "ok",
                "simulation_tick_seconds": config.simulation_tick_seconds,
                "frontend_poll_seconds": config.frontend_poll_seconds,
                "gemini_enabled": bool(config.gemini_api_key),
            }
        )

    return app


app = create_app()
seed_if_empty()
start_background_simulation()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050, debug=True)
