"""
Centralized Database Connection Manager for Nova Sonic Voice Processing
Optimized for RDS Proxy with connection pooling and automatic cleanup
"""

import os
import json
import logging
import psycopg2
from psycopg2 import pool
from contextlib import contextmanager
import boto3
from typing import Optional, Dict, Any
import threading
import time

# Configure logging
logger = logging.getLogger(__name__)

class VoiceConnectionManager:
    """
    Singleton database connection manager optimized for voice processing workloads
    Reduces connection count and improves reliability for Nova Sonic
    """
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(VoiceConnectionManager, cls).__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
            
        self._initialized = True
        self._pool = None
        self._config = None
        self._last_health_check = 0
        self._health_check_interval = 300  # 5 minutes
        
        # Optimized settings for voice workloads with RDS Proxy
        self.min_connections = 2          # Higher minimum for voice
        self.max_connections = 10         # Increased from 5 to handle voice bursts
        self.connection_timeout = 30      # Prevent hanging
        self.idle_timeout = 300          # 5 min cleanup
        
        logger.info("🔗 VOICE_DB_MANAGER: Initializing voice connection manager")
        logger.info(f"🔗 VOICE_POOL_CONFIG: min={self.min_connections}, max={self.max_connections}, timeout={self.connection_timeout}s")
        
    def _get_db_config(self) -> Dict[str, Any]:
        """Get database configuration from environment and secrets"""
        if self._config is not None:
            return self._config
            
        try:
            # Get configuration from environment
            db_secret_name = os.environ.get('SM_DB_CREDENTIALS')
            rds_endpoint = os.environ.get('RDS_PROXY_ENDPOINT')
            
            if not db_secret_name or not rds_endpoint:
                raise ValueError("Missing required environment variables: SM_DB_CREDENTIALS, RDS_PROXY_ENDPOINT")
            
            # Get credentials from AWS Secrets Manager
            secrets_client = boto3.client('secretsmanager')
            secret_response = secrets_client.get_secret_value(SecretId=db_secret_name)
            secret = json.loads(secret_response['SecretString'])
            
            self._config = {
                'host': rds_endpoint,
                'port': secret['port'],
                'database': secret['dbname'],
                'user': secret['username'],
                'password': secret['password'],
                'connect_timeout': self.connection_timeout,
                'application_name': f"nova_sonic_voice_{os.environ.get('SESSION_ID', 'unknown')}"
            }
            
            logger.info(f"🔗 VOICE_CONFIG_SUCCESS: endpoint={rds_endpoint}, user={secret['username']}, db={secret['dbname']}")
            return self._config
            
        except Exception as e:
            logger.error(f"❌ VOICE_CONFIG_ERROR: {e}")
            raise
    
    def _create_pool(self):
        """Create optimized connection pool for voice processing"""
        try:
            config = self._get_db_config()
            
            logger.info(f"🏗️ VOICE_POOL_CREATION: Creating pool with {self.min_connections}-{self.max_connections} connections")
            
            self._pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=self.min_connections,
                maxconn=self.max_connections,
                **config
            )
            
            # Test the pool
            test_conn = self._pool.getconn()
            test_conn.close()
            self._pool.putconn(test_conn)
            
            logger.info("✅ VOICE_POOL_CREATED: Voice connection pool initialized successfully")
            logger.info(f"🔗 VOICE_POOL_OPTIMIZATION: Optimized for voice workloads with {self.max_connections} max connections")
            
        except Exception as e:
            logger.error(f"❌ VOICE_POOL_CREATION_ERROR: {e}")
            raise
    
    def get_connection(self):
        """Get connection from pool (non-context manager for compatibility)"""
        if self._pool is None:
            self._create_pool()
        
        try:
            logger.debug("🔗 VOICE_CONNECTION_REQUEST: Getting connection from voice pool")
            connection = self._pool.getconn()
            
            if connection is None:
                raise Exception("Failed to get connection from voice pool")
            
            logger.debug("🔗 VOICE_CONNECTION_ACQUIRED: Got connection from voice pool")
            return connection
            
        except Exception as e:
            logger.error(f"❌ VOICE_CONNECTION_ERROR: {e}")
            raise
    
    def return_connection(self, connection):
        """Return connection to pool"""
        if connection and self._pool:
            try:
                # Ensure transaction is clean
                if not connection.closed:
                    connection.rollback()
                
                # Return connection to pool
                self._pool.putconn(connection)
                logger.debug("🔗 VOICE_CONNECTION_RETURNED: Connection returned to voice pool")
                
            except Exception as e:
                logger.warning(f"⚠️ VOICE_CONNECTION_CLEANUP_WARNING: {e}")
    
    def get_pool_status(self) -> Dict[str, Any]:
        """Get current pool status for monitoring"""
        if not self._pool:
            return {"status": "not_initialized"}
        
        return {
            "status": "active",
            "min_connections": self.min_connections,
            "max_connections": self.max_connections,
            "pool_type": "ThreadedConnectionPool",
            "optimized_for": "voice_processing",
            "last_health_check": self._last_health_check
        }
    
    def close_pool(self):
        """Close all connections in the pool"""
        if self._pool:
            logger.info("🔗 VOICE_POOL_CLOSING: Closing voice connection pool")
            self._pool.closeall()
            self._pool = None
            logger.info("✅ VOICE_POOL_CLOSED: Voice connection pool closed")

# Global instance for voice processing
voice_db_manager = VoiceConnectionManager()

def get_pg_connection():
    """Get PostgreSQL connection for voice processing (backward compatibility)"""
    return voice_db_manager.get_connection()

def return_pg_connection(connection):
    """Return PostgreSQL connection (backward compatibility)"""
    voice_db_manager.return_connection(connection)

# Log initialization
logger.info("🏗️ VOICE_RDS_OPTIMIZATION: Voice connection manager loaded")
logger.info("🏗️ VOICE_CONNECTION_POOLING: Optimized for Nova Sonic voice processing")