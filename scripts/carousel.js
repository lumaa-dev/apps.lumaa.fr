"use strict";

(function () {
    var DEFAULTS = {
        speed: 90,
        duration: null,
        gap: 10,
        run: "always",
        hoverPause: false,
        direction: "left",
        reducedMotion: "stop"
    };

    function toNumber(value, fallback) {
        var num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }

    function toBoolean(value, fallback) {
        if (value === undefined || value === null || value === "") {
            return fallback;
        }

        if (typeof value === "boolean") {
            return value;
        }

        var normalized = String(value).toLowerCase();
        if (normalized === "true") {
            return true;
        } else if (normalized === "false") {
            return false;
        }
        return fallback;
    }

    function getDatasetOptions(element) {
        return {
            speed: element.dataset.speed,
            duration: element.dataset.duration,
            gap: element.dataset.gap,
            run: element.dataset.run,
            hoverPause: element.dataset.hoverPause,
            direction: element.dataset.direction,
            reducedMotion: element.dataset.reducedMotion
        };
    }

    function normalizeOptions(rawOptions) {
        var options = rawOptions || {};

        var run = options.run === "hover" ? "hover" : "always";
        var direction = options.direction === "right" ? "right" : "left";
        var reducedMotion = options.reducedMotion === "ignore" ? "ignore" : "stop";
        var speed = Math.max(1, toNumber(options.speed, DEFAULTS.speed));
        var duration = toNumber(options.duration, null);
        var gap = Math.max(0, toNumber(options.gap, DEFAULTS.gap));

        if (!Number.isFinite(duration) || duration <= 0) {
            duration = null;
        }

        return {
            speed: speed,
            duration: duration,
            gap: gap,
            run: run,
            hoverPause: toBoolean(options.hoverPause, DEFAULTS.hoverPause),
            direction: direction,
            reducedMotion: reducedMotion
        };
    }

    function setFocusableDisabled(container) {
        var focusables = container.querySelectorAll(
            "a, button, input, select, textarea, [tabindex]"
        );
        focusables.forEach(function (node) {
            if (node.hasAttribute("tabindex")) {
                node.dataset.originalTabindex = node.getAttribute("tabindex");
            }
            node.setAttribute("tabindex", "-1");
        });
    }

    function restoreFocusable(container) {
        var focusables = container.querySelectorAll(
            "a, button, input, select, textarea, [tabindex]"
        );
        focusables.forEach(function (node) {
            if (node.dataset.originalTabindex !== undefined) {
                node.setAttribute("tabindex", node.dataset.originalTabindex);
                delete node.dataset.originalTabindex;
                return;
            }

            if (node.getAttribute("tabindex") === "-1") {
                node.removeAttribute("tabindex");
            }
        });
    }

    function Carousel(element, options) {
        if (!(element instanceof HTMLElement)) {
            throw new Error("Carousel expects a valid HTMLElement");
        }

        this.element = element;
        this.baseOptions = normalizeOptions(Object.assign({}, DEFAULTS, options || {}));
        this.options = normalizeOptions(
            Object.assign({}, this.baseOptions, getDatasetOptions(element))
        );
        this.track = null;
        this.sourceGroup = null;
        this.cloneGroups = [];
        this.rafId = null;
        this.isHovered = false;

        this.onPointerEnter = this.onPointerEnter.bind(this);
        this.onPointerLeave = this.onPointerLeave.bind(this);
        this.onOrientationChange = this.scheduleRefresh.bind(this);
        this.onWindowLoad = this.scheduleRefresh.bind(this);
        this.onWindowResize = this.scheduleRefresh.bind(this);
        this.onMutation = this.scheduleRefresh.bind(this);
        this.onSourceLoad = this.onSourceLoad.bind(this);

        this.reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        this.onReducedMotionChange = this.updatePlayState.bind(this);

        this.setupStructure();
        this.bindEvents();
        this.refresh();
    }

    Carousel.prototype.setupStructure = function () {
        if (this.element.children.length === 0) {
            return;
        }

        this.track = document.createElement("div");
        this.track.className = "carousel-track";

        this.sourceGroup = document.createElement("div");
        this.sourceGroup.className = "carousel-group";

        while (this.element.firstChild) {
            this.sourceGroup.appendChild(this.element.firstChild);
        }

        this.track.appendChild(this.sourceGroup);
        this.element.appendChild(this.track);
        this.element.classList.add("is-enhanced");
    };

    Carousel.prototype.bindEvents = function () {
        if (!this.sourceGroup) {
            return;
        }

        this.element.addEventListener("mouseenter", this.onPointerEnter);
        this.element.addEventListener("mouseleave", this.onPointerLeave);
        this.element.addEventListener("focusin", this.onPointerEnter);
        this.element.addEventListener("focusout", this.onPointerLeave);

        if (typeof ResizeObserver === "function") {
            this.resizeObserver = new ResizeObserver(this.scheduleRefresh.bind(this));
            this.resizeObserver.observe(this.element);
        } else {
            window.addEventListener("resize", this.onWindowResize);
        }

        this.mutationObserver = new MutationObserver(this.onMutation);
        this.mutationObserver.observe(this.sourceGroup, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
        });

        this.sourceGroup.addEventListener("load", this.onSourceLoad, true);
        window.addEventListener("orientationchange", this.onOrientationChange);
        window.addEventListener("load", this.onWindowLoad);

        if (typeof this.reducedMotionQuery.addEventListener === "function") {
            this.reducedMotionQuery.addEventListener("change", this.onReducedMotionChange);
        } else if (typeof this.reducedMotionQuery.addListener === "function") {
            this.reducedMotionQuery.addListener(this.onReducedMotionChange);
        }
    };

    Carousel.prototype.onSourceLoad = function (event) {
        if (event.target && event.target.tagName === "IMG") {
            this.scheduleRefresh();
        }
    };

    Carousel.prototype.scheduleRefresh = function () {
        var self = this;
        if (this.rafId) {
            return;
        }

        this.rafId = window.requestAnimationFrame(function () {
            self.rafId = null;
            self.refresh();
        });
    };

    Carousel.prototype.clearClones = function () {
        if (!this.track) {
            return;
        }

        this.cloneGroups.forEach(function (group) {
            restoreFocusable(group);
            group.remove();
        });
        this.cloneGroups = [];
    };

    Carousel.prototype.applyOptionsFromDataset = function () {
        this.options = normalizeOptions(
            Object.assign({}, this.baseOptions, getDatasetOptions(this.element))
        );
    };

    Carousel.prototype.refresh = function () {
        if (!this.track || !this.sourceGroup) {
            return;
        }

        this.applyOptionsFromDataset();
        this.clearClones();

        this.element.style.setProperty("--carousel-gap", this.options.gap + "px");
        this.element.classList.remove("is-direction-left", "is-direction-right");
        this.element.classList.add(
            this.options.direction === "right" ? "is-direction-right" : "is-direction-left"
        );

        var sourceWidth = this.sourceGroup.getBoundingClientRect().width;
        var containerWidth = this.element.getBoundingClientRect().width;

        if (!sourceWidth || !containerWidth || this.sourceGroup.children.length === 0) {
            this.element.style.setProperty("--carousel-play-state", "paused");
            return;
        }

        var requiredGroups = Math.max(2, Math.ceil(1 + containerWidth / sourceWidth));
        for (var i = 1; i < requiredGroups; i += 1) {
            var clone = this.sourceGroup.cloneNode(true);
            clone.setAttribute("aria-hidden", "true");
            setFocusableDisabled(clone);
            this.track.appendChild(clone);
            this.cloneGroups.push(clone);
        }

        var duration = this.options.duration;
        if (!duration) {
            duration = sourceWidth / this.options.speed;
        }
        duration = Math.max(0.1, duration);

        this.element.style.setProperty("--carousel-cycle-width", sourceWidth + "px");
        this.element.style.setProperty("--carousel-duration", duration + "s");
        this.updatePlayState();
    };

    Carousel.prototype.updatePlayState = function () {
        if (!this.track) {
            return;
        }

        if (
            this.options.reducedMotion === "stop" &&
            this.reducedMotionQuery &&
            this.reducedMotionQuery.matches
        ) {
            this.element.style.setProperty("--carousel-play-state", "paused");
            return;
        }

        var isRunning = this.options.run === "always";

        if (this.options.run === "hover") {
            isRunning = this.isHovered;
        }

        if (this.options.run === "always" && this.options.hoverPause && this.isHovered) {
            isRunning = false;
        }

        this.element.style.setProperty("--carousel-play-state", isRunning ? "running" : "paused");
    };

    Carousel.prototype.onPointerEnter = function () {
        this.isHovered = true;
        this.updatePlayState();
    };

    Carousel.prototype.onPointerLeave = function (event) {
        if (event.type === "focusout" && this.element.contains(event.relatedTarget)) {
            return;
        }

        this.isHovered = false;
        this.updatePlayState();
    };

    Carousel.prototype.destroy = function () {
        if (this.rafId) {
            window.cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        } else {
            window.removeEventListener("resize", this.onWindowResize);
        }

        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
        }

        this.sourceGroup && this.sourceGroup.removeEventListener("load", this.onSourceLoad, true);
        this.element.removeEventListener("mouseenter", this.onPointerEnter);
        this.element.removeEventListener("mouseleave", this.onPointerLeave);
        this.element.removeEventListener("focusin", this.onPointerEnter);
        this.element.removeEventListener("focusout", this.onPointerLeave);
        window.removeEventListener("orientationchange", this.onOrientationChange);
        window.removeEventListener("load", this.onWindowLoad);

        if (typeof this.reducedMotionQuery.removeEventListener === "function") {
            this.reducedMotionQuery.removeEventListener("change", this.onReducedMotionChange);
        } else if (typeof this.reducedMotionQuery.removeListener === "function") {
            this.reducedMotionQuery.removeListener(this.onReducedMotionChange);
        }

        this.clearClones();

        if (this.track && this.sourceGroup) {
            while (this.sourceGroup.firstChild) {
                this.element.appendChild(this.sourceGroup.firstChild);
            }
            this.track.remove();
        }

        this.element.classList.remove("is-enhanced", "is-direction-left", "is-direction-right");
        this.element.style.removeProperty("--carousel-gap");
        this.element.style.removeProperty("--carousel-duration");
        this.element.style.removeProperty("--carousel-cycle-width");
        this.element.style.removeProperty("--carousel-play-state");
        delete this.element.__carouselInstance;
    };

    Carousel.initAll = function (selector, options) {
        var targetSelector = selector || ".h-carousel.auto";
        return Array.from(document.querySelectorAll(targetSelector))
            .map(function (element) {
                if (element.__carouselInstance) {
                    return element.__carouselInstance;
                }

                var instance = new Carousel(element, options);
                element.__carouselInstance = instance;
                return instance;
            })
            .filter(Boolean);
    };

    window.Carousel = Carousel;

    document.addEventListener("DOMContentLoaded", function () {
        Carousel.initAll(".h-carousel.auto");
    });
})();
