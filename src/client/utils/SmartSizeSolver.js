/**
 * SmartSizeSolver - Wrapper for AdvancedSmartSizeSolver
 * Provides backward compatibility while using the advanced multi-algorithm packer
 */

import AdvancedSmartSizeSolver from './AdvancedSmartSizeSolver';

const MAX_SIZE_LIMIT = 4096;

class SmartSizeSolver {
    /**
     * Calculate optimal atlas dimensions using the advanced multi-algorithm solver
     * @param {Array} rects - Array of sprite rectangles with frame.w and frame.h
     * @param {Object} options - Solver options
     * @returns {Object} - { width, height, efficiency, algorithm, rects }
     */
    static calculateOptimalDimensions(rects, options = {}) {
        // Use advanced solver for better results
        return AdvancedSmartSizeSolver.calculateOptimalDimensions(rects, {
            padding: options.padding || 0,
            borderPadding: options.borderPadding || 0,
            allowRotation: options.allowRotation || false,
            disableMaxLimit: options.disableMaxLimit || false,
            powerOfTwo: options.powerOfTwo || false,
            algorithm: options.algorithm || AdvancedSmartSizeSolver.ALGORITHM.BEST
        });
    }

    /**
     * Legacy method for backward compatibility
     */
    static calculateMinHeight(rects, width, padding, borderPadding, maxSizeLimit) {
        // Simplified calculation for compatibility
        const sorted = [...rects].sort((a, b) => b.frame.h - a.frame.h);
        let height = padding + borderPadding;
        let rowHeight = 0;
        let x = borderPadding + padding;

        for (let rect of sorted) {
            const spriteWidth = rect.frame.w + padding * 2;
            const spriteHeight = rect.frame.h + padding * 2;

            if (x + spriteWidth > width - borderPadding - padding) {
                x = borderPadding + padding;
                height += rowHeight;
                rowHeight = 0;
            }

            x += spriteWidth;
            if (spriteHeight > rowHeight) rowHeight = spriteHeight;
        }

        height += rowHeight + borderPadding + padding;
        return Math.min(height, maxSizeLimit);
    }

    /**
     * Check if scaling is required for the given dimensions
     */
    static checkScaleRequired(width, height, maxSize = MAX_SIZE_LIMIT) {
        return AdvancedSmartSizeSolver.checkScaleRequired(width, height, maxSize);
    }

    /**
     * Get available algorithms
     */
    static getAlgorithms() {
        return AdvancedSmartSizeSolver.ALGORITHM;
    }

    /**
     * Get algorithm display names
     */
    static getAlgorithmNames() {
        return AdvancedSmartSizeSolver.ALGORITHM_NAMES;
    }
}

// Re-export for direct access if needed
SmartSizeSolver.Advanced = AdvancedSmartSizeSolver;
SmartSizeSolver.MAX_SIZE_LIMIT = MAX_SIZE_LIMIT;

export default SmartSizeSolver;