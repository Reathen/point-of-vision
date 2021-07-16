"use strict";

import {libWrapper} from './libwrapper/shim.js'

const moduleID = 'point-of-vision';
const settingKey = 'pov';
const epsilon = 0.01;
let globalDefault = 0;
let expandVisibilityCheck = false;

const Option = {
    CENTER: 0,
    TOP_LEFT: 1,
    TOP_RIGHT: 2,
    BOTTOM_LEFT: 3,
    BOTTOM_RIGHT: 4,
    ALL_CORNERS_AND_CENTER: 5,
    TOP: 6,
    BOTTOM: 7,
    LEFT: 8,
    RIGHT: 9,
    ALL_MIDS_AND_CENTER: 10,
}

export class PointOfVision {
    static init() {
        Token.prototype.getSightOrigin = function (selectedIndex = 0) {
            // Using the normal calculation (below) results in non-deterministic origins
            // let p = this.center;
            // let origin = {
            //     x: p.x - this._velocity.sx,
            //     y: p.y - this._velocity.sy,
            // };
            let origin = this.center;

            // For Left/Bottom we prevent ending up exactly on the grid line, as that puts us into the next grid
            switch (selectedIndex) {
                case Option.CENTER:
                    return origin;
                case Option.TOP_LEFT:
                    return {
                        x: origin.x - this.w / 2 + epsilon,
                        y: origin.y - this.h / 2 + epsilon,
                    };
                case Option.TOP_RIGHT:
                    return {
                        x: origin.x + this.w / 2,
                        y: origin.y - this.h / 2 + epsilon,
                    };
                case Option.BOTTOM_LEFT:
                    return {
                        x: origin.x - this.w / 2 + epsilon,
                        y: origin.y + this.h / 2,
                    };
                case Option.BOTTOM_RIGHT:
                    return {
                        x: origin.x - this.w / 2 + epsilon,
                        y: origin.y + this.h / 2,
                    };
                case Option.TOP:
                    return {
                        x: origin.x,
                        y: origin.y - this.h / 2 + epsilon,
                    };
                case Option.BOTTOM:
                    return {
                        x: origin.x,
                        y: origin.y + this.h / 2,
                    };
                case Option.LEFT:
                    return {
                        x: origin.x - this.w / 2 + epsilon,
                        y: origin.y,
                    };
                case Option.RIGHT:
                    return {
                        x: origin.x + this.w / 2,
                        y: origin.y,
                    };

                default:
                    console.error("Invalid option sent to Token.getSightOrigin");
                    return undefined;
            }
        }

        /**
         * Update the light and vision source objects associated with this Token
         * @param {boolean} [defer]           Defer refreshing the SightLayer to manually call that refresh later.
         * @param {boolean} [deleted]         Indicate that this light source has been deleted.
         * @param {boolean} [noUpdateFog]     Never update the Fog exploration progress for this update.
         */
        libWrapper.register(moduleID, 'Token.prototype.updateSource', function (wrapped, {
            defer = false,
            deleted = false,
            noUpdateFog = false
        } = {}) {
            wrapped({defer: true, deleted, noUpdateFog});

            let originalSource = canvas.sight.sources.get(this.sourceId);
            if (originalSource) {
                for (let sourceId of canvas.sight.sources.keys()) {
                    if (sourceId.startsWith(this.sourceId)) {
                        canvas.sight.sources.delete(sourceId);
                    }
                }

                let token = this;
                let createSource = function (index, inPlaceSource) {
                    let source = inPlaceSource ? inPlaceSource : new PointSource(originalSource.object);
                    let origin = token.getSightOrigin(index);
                    source.initialize({
                        x: origin.x,
                        y: origin.y,
                        z: originalSource.z,
                        dim: originalSource.dim,
                        bright: originalSource.right,
                        angle: originalSource.angle,
                        rotation: originalSource.rotation,
                        color: originalSource.color,
                        alpha: originalSource.alpha,
                        darkness: originalSource.darkness,
                        type: originalSource.sourceType,
                        animation: originalSource.animation,
                        seed: originalSource.seed,
                    });
                    return source;
                }

                let sel = this.document.getFlag(moduleID, settingKey);
                if (typeof sel === 'undefined') {
                    sel = globalDefault;
                }

                let updatedSources = [];
                if (sel == Option.ALL_CORNERS_AND_CENTER || sel == Option.ALL_MIDS_AND_CENTER) {
                    let source = createSource(Option.CENTER, this.vision);
                    updatedSources.push(source);
                    canvas.sight.sources.set(this.sourceId, source);
                    for (let c = sel - 4; c < sel; ++c) {
                        let source = createSource(c);
                        updatedSources.push(source);
                        canvas.sight.sources.set(`${this.sourceId}-${c}`, source);
                    }
                } else {
                    let source = createSource(sel, this.vision);
                    updatedSources.push(source);
                    canvas.sight.sources.set(this.sourceId, source);
                }

                if (!defer) {
                    for (let source of updatedSources) {
                        source.drawLight();
                    }
                    canvas.sight.refresh({noUpdateFog});
                }
            } else {
                if (!defer && deleted) canvas.sight.refresh();
            }
        }, 'WRAPPER');

        SightLayer.prototype._pov_testVisibility = function (token) {
            const visionSources = this.sources;
            const lightSources = canvas.lighting.sources;
            if (!visionSources.size) return game.user.isGM;

            // Determine the array of offset points to test
            const point = token.center;
            const wOffset = token.w / 2;
            const hOffset = token.h / 2;
            const offsets = [
                [0, 0],
                [-wOffset+epsilon, 0],
                [wOffset, 0],
                [0, -hOffset+epsilon],
                [0, hOffset],
                [-wOffset+epsilon, -hOffset],
                [-wOffset+epsilon, hOffset],
                [wOffset, hOffset],
                [wOffset, -hOffset+epsilon],
            ];
            const points = offsets.map(o => new PIXI.Point(point.x + o[0], point.y + o[1]));

            // Test that a point falls inside a line-of-sight polygon
            let inLOS = false;
            for (let source of visionSources.values()) {
                if (points.some(p => source.los.contains(p.x, p.y) ) ) {
                    inLOS = true;
                    break;
                }
            }
            if (!inLOS) return false;

            // If global illumination is active, nothing more is required
            if (canvas.lighting.globalLight) return true;

            // Test that a point is also within some field-of-vision polygon
            for (let source of visionSources.values()) {
                if (points.some(p => source.fov.contains(p.x, p.y))) return true;
            }
            for (let source of lightSources.values()) {
                if (points.some(p => source.fov.contains(p.x, p.y))) return true;
            }
            return false;
        };

        libWrapper.register(moduleID, 'Token.prototype.isVisible', function (wrapped) {
            if (!expandVisibilityCheck) {
                return wrapped();
            }

            const gm = game.user.isGM;
            if (this.data.hidden) return gm;
            if (!canvas.sight.tokenVision) return true;
            if (this._controlled) return true;
            if (canvas.sight.sources.has(this.sourceId)) return true;
            return canvas.sight._pov_testVisibility(this);
        }, 'MIXED');
    }

    static registerSettings() {
        game.settings.register(moduleID, settingKey, {
            name: game.i18n.localize(moduleID+".default"),
            scope: "world",
            config: true,
            type: Number,
            choices: {
                // Center
                0 /* Options.Center */: game.i18n.localize(moduleID+".option.0"),
                // All Corners + Center
                5 /* Options.AllCornersAndCenter */: game.i18n.localize(moduleID+".option.5"),
                // All Mids + Center
                10 /*Options.AllMidsAndCenter */: game.i18n.localize(moduleID+".option.10"),
            },
            default: 5,
            onChange: value => { globalDefault = value; }
        });
        globalDefault = game.settings.get(moduleID, settingKey);

        game.settings.register(moduleID, "expandVisibility", {
            name: game.i18n.localize(moduleID+".expandVisibility"),
            scope: "world",
            config: true,
            type: Boolean,
            default: true,
            onChange: value => { expandVisibilityCheck = value; }
        });
        expandVisibilityCheck = game.settings.get(moduleID, "expandVisibility");
    }

    static tokenConfigOptionValue(option) {
        return `<option value="${option}">${game.i18n.localize(`${moduleID}.option.${option}`)}</option>"`;
    }

    static renderTokenConfig(tokenconfig) {
        let newFormEntry = '<div class="form-group">';
        newFormEntry += `<label>${game.i18n.localize(`${moduleID}.token_setting`)}</label>`;
        newFormEntry += '<select id="pov" name="pov" data-dtype="Number">';
        newFormEntry += `<option value="-1">Default (${game.i18n.localize(`${moduleID}.option.${globalDefault}`)})</option>`;
        newFormEntry += `<option value="${Option.CENTER}">${game.i18n.localize(`${moduleID}.option.${Option.CENTER}`)} (Foundry Default)</option>`;
        newFormEntry += `<optgroup label="${game.i18n.localize(`${moduleID}.option.group.corners`)}">`;
        newFormEntry += PointOfVision.tokenConfigOptionValue(Option.TOP_LEFT);
        newFormEntry += PointOfVision.tokenConfigOptionValue(Option.TOP_RIGHT);
        newFormEntry += PointOfVision.tokenConfigOptionValue(Option.BOTTOM_LEFT);
        newFormEntry += PointOfVision.tokenConfigOptionValue(Option.BOTTOM_RIGHT);
        newFormEntry += PointOfVision.tokenConfigOptionValue(Option.ALL_CORNERS_AND_CENTER);
        newFormEntry += '</optgroup>';
        newFormEntry += `<optgroup label="${game.i18n.localize(`${moduleID}.option.group.midpoints`)}">`;
        newFormEntry += PointOfVision.tokenConfigOptionValue(Option.TOP);
        newFormEntry += PointOfVision.tokenConfigOptionValue(Option.BOTTOM);
        newFormEntry += PointOfVision.tokenConfigOptionValue(Option.LEFT);
        newFormEntry += PointOfVision.tokenConfigOptionValue(Option.RIGHT);
        newFormEntry += PointOfVision.tokenConfigOptionValue(Option.ALL_MIDS_AND_CENTER);
        newFormEntry += '</optgroup>';
        newFormEntry += '</select>';
        newFormEntry += '</div>';

        $("input[name='vision']").parent().after(newFormEntry);

        let currentValue = tokenconfig.object.getFlag(moduleID, settingKey);
        if (typeof currentValue === 'undefined') {
            currentValue = -1;
        }

        $('#pov').val(currentValue);
    }

    static async preUpdateToken(document, change, options, userId) {
        if (change.hasOwnProperty('pov')) {
            if (change.pov == -1) {
                document.unsetFlag(moduleID, settingKey);
            } else {
                document.setFlag(moduleID, settingKey, change.pov);
            }
        }
    }
}

Hooks.on("init", PointOfVision.init);
Hooks.once("renderSceneControls", PointOfVision.registerSettings);
Hooks.on("renderTokenConfig", PointOfVision.renderTokenConfig);
Hooks.on("preUpdateToken", PointOfVision.preUpdateToken);
