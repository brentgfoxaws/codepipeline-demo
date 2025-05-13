from flask import Flask, jsonify

app = Flask(__name__)

@app.route('/')
def hello():
    return 'Hello, This is a demo for deployment, now running in YYC that I created with Q Developer on 13-MAY-25 (orginally from 09-MAY-25).\n'

@app.route('/health')
def health():
    """Health check endpoint for the load balancer target group."""
    return jsonify({"status": "healthy"}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)